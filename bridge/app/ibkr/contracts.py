from __future__ import annotations

from dataclasses import dataclass
from typing import Any

try:
    from ibapi.contract import Contract
except ImportError:  # pragma: no cover - exercised by setup diagnostics
    Contract = None  # type: ignore[assignment,misc]


@dataclass(frozen=True)
class EventContractSpec:
    symbol: str
    sec_type: str
    exchange: str
    currency: str
    expiry: str
    strike: float
    outcome: str
    trading_class: str = ""
    conid: int | None = None


def contract_from_payload(payload: dict[str, Any]) -> Any:
    if Contract is None:
        raise RuntimeError("The official IBKR Python TWS API package is not installed.")
    contract = Contract()
    contract.conId = int(payload.get("conid") or payload.get("ibkr_conid") or 0)
    contract.symbol = str(payload.get("symbol", ""))
    contract.secType = str(payload.get("sec_type", payload.get("secType", "OPT"))).upper()
    contract.exchange = str(payload.get("exchange", ""))
    contract.currency = str(payload.get("currency", "USD"))
    if payload.get("primary_exchange"):
        contract.primaryExchange = str(payload["primary_exchange"])

    # Stock contracts must not carry derivative-only fields. IBKR treats an
    # STK request with an expiry/right/strike as a different (and invalid)
    # security definition, which produces error 200 during qualification and
    # market-data requests.
    if contract.secType != "STK":
        contract.lastTradeDateOrContractMonth = str(payload.get("expiry", payload.get("last_trade_date_or_contract_month", "")))
        outcome = str(payload.get("outcome", "YES")).upper()
        contract.right = "C" if outcome == "YES" else "P"
        contract.strike = float(payload.get("strike", 0) or 0)
        if payload.get("trading_class"):
            contract.tradingClass = str(payload["trading_class"])
        if payload.get("local_symbol"):
            contract.localSymbol = str(payload["local_symbol"])
    elif contract.conId:
        # Once qualification has supplied a conId it is the authoritative
        # identity. Avoid adding symbol/class constraints that can conflict
        # with the resolved IBKR contract.
        contract.symbol = ""
    return contract


def contract_details_to_dict(details: Any) -> dict[str, Any]:
    contract = details.contract
    return {
        "conid": int(getattr(contract, "conId", 0) or 0),
        "symbol": str(getattr(contract, "symbol", "")),
        "sec_type": str(getattr(contract, "secType", "")),
        "exchange": str(getattr(contract, "exchange", "")),
        "listing_exchange": str(getattr(contract, "primaryExchange", "") or ""),
        "currency": str(getattr(contract, "currency", "")),
        "last_trade_date_or_contract_month": str(getattr(contract, "lastTradeDateOrContractMonth", "") or ""),
        "real_expiration_date": str(getattr(details, "realExpirationDate", "") or ""),
        "right": str(getattr(contract, "right", "") or ""),
        "strike": float(getattr(contract, "strike", 0) or 0),
        "local_symbol": str(getattr(contract, "localSymbol", "") or ""),
        "trading_class": str(getattr(contract, "tradingClass", "") or ""),
        "min_tick": float(getattr(details, "minTick", 0) or 0),
        "market_name": str(getattr(details, "marketName", "") or ""),
        "long_name": str(getattr(details, "longName", "") or ""),
    }
