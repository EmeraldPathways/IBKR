from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from ..config import Config


class RiskGuardError(RuntimeError):
    pass


def require_live_gate(config: Config, kill_switch: bool) -> None:
    if kill_switch:
        raise RiskGuardError("Kill switch is active.")
    if not config.live_gate_configured:
        raise RiskGuardError("Live execution is not enabled by the bridge safety gate.")
    if config.manual_approval_required is not True:
        raise RiskGuardError("Manual approval configuration is invalid.")


def validate_order_command(
    command: dict[str, Any],
    quote: dict[str, Any],
    account: dict[str, Any],
    open_orders: int,
    config: Config,
    kill_switch: bool,
    risk_snapshot: dict[str, Any] | None = None,
) -> None:
    require_live_gate(config, kill_switch)
    if command.get("approved") is not True:
        raise RiskGuardError("The command does not contain an explicit approval record.")
    approval_expiry = _parse_time(command.get("approval_expires_at"))
    if approval_expiry is None or approval_expiry <= datetime.now(timezone.utc):
        raise RiskGuardError("Manual approval has expired.")
    if str(command.get("order_type", "LMT")).upper() != "LMT":
        raise RiskGuardError("Only limit orders are allowed.")
    if str(command.get("tif", "DAY")).upper() not in {"DAY", "GTC", "IOC"}:
        raise RiskGuardError("Unsupported event-contract time in force.")
    if str(command.get("action", "BUY")).upper() not in {"BUY", "SELL"}:
        raise RiskGuardError("Invalid order action.")
    if str(command.get("exchange", "")).upper() == "FORECASTX" and str(command.get("action", "BUY")).upper() != "BUY":
        raise RiskGuardError("ForecastEx contracts cannot be sold; buy the opposing contract to reduce exposure.")
    quantity = float(command.get("quantity", 0))
    price = float(command.get("limit_price", 0))
    if quantity <= 0 or quantity != int(quantity):
        raise RiskGuardError("Event-contract quantity must be a positive whole number.")
    if price <= 0:
        raise RiskGuardError("Limit price must be positive.")
    max_entry = float(command.get("max_entry_price", 0))
    if price > max_entry:
        raise RiskGuardError("Limit price is above the approved price ceiling.")
    quote_time = _parse_time(quote.get("observed_at"))
    if quote_time is None or (datetime.now(timezone.utc) - quote_time).total_seconds() > 90:
        raise RiskGuardError("Quote is stale.")
    if quote.get("ask") is None:
        raise RiskGuardError("A current ask/offer is unavailable.")
    if float(quote["ask"]) > max_entry:
        raise RiskGuardError("Refreshed quote is above the approved price ceiling.")
    notional = quantity * price
    if notional > config.max_order_size_usd:
        raise RiskGuardError("Order exceeds the bridge maximum order size.")
    if risk_snapshot is None:
        raise RiskGuardError("Site risk snapshot is missing; live execution is halted.")
    current_exposure = float(risk_snapshot.get("current_exposure", 0))
    total_exposure = float(risk_snapshot.get("total_exposure", 0))
    daily_pnl = float(risk_snapshot.get("daily_pnl", 0))
    starting_capital = float(risk_snapshot.get("starting_capital", config.starting_capital_usd))
    if current_exposure + notional > config.max_position_per_contract_usd:
        raise RiskGuardError("Order exceeds the bridge per-contract exposure cap.")
    if total_exposure + notional > config.max_total_exposure_usd:
        raise RiskGuardError("Order exceeds the bridge aggregate exposure cap.")
    if daily_pnl <= -config.max_daily_loss_usd:
        raise RiskGuardError("Daily loss halt is active.")
    if starting_capital <= 0 or starting_capital - notional < starting_capital * config.min_account_floor_percent / 100:
        raise RiskGuardError("Order would breach the bridge account floor.")
    if open_orders >= config.max_concurrent_orders:
        raise RiskGuardError("Maximum concurrent order count reached.")
    available_funds = _account_number(account, "AvailableFunds")
    if available_funds is not None and notional > available_funds:
        raise RiskGuardError("Available funds are below the order notional.")


def _account_number(account: dict[str, Any], tag: str) -> float | None:
    item = account.get(tag)
    if isinstance(item, dict):
        item = item.get("value")
    try:
        return float(item) if item is not None else None
    except (TypeError, ValueError):
        return None


def _parse_time(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None
