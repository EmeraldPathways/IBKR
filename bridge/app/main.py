from __future__ import annotations

import json
import os
import signal
import sys
import tempfile
import threading
import time
from typing import Any

try:
    from dotenv import load_dotenv
except ImportError:  # The setup script installs python-dotenv for runtime use.
    def load_dotenv(*_args: Any, **_kwargs: Any) -> bool:
        return False

from .config import Config
from .ibkr.adapter import IBKRAdapter
from .alpaca.adapter import AlpacaAdapter
from .yfinance_adapter import YFinanceAdapter
from .logging_config import configure_logging
from .polling.site_client import BridgeSecurityError, SiteClient
from .reconciliation.manager import make_reconciliation_event
from .risk.local_guard import RiskGuardError, validate_order_command


VERSION = "0.1.0"


class LocalIdempotency:
    def __init__(self, data_dir: str) -> None:
        os.makedirs(data_dir, mode=0o750, exist_ok=True)
        self.path = os.path.join(data_dir, "processed-order-keys.json")
        self._lock = threading.Lock()
        self._keys = self._read()

    def contains(self, key: str) -> bool:
        with self._lock:
            return key in self._keys

    def add(self, key: str) -> None:
        with self._lock:
            self._keys.add(key)
            self._write()

    def _read(self) -> set[str]:
        try:
            with open(self.path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
            return {str(item) for item in data if isinstance(item, str)}
        except (OSError, ValueError):
            return set()

    def _write(self) -> None:
        directory = os.path.dirname(self.path)
        fd, temporary = tempfile.mkstemp(prefix="processed-order-", dir=directory, text=True)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(sorted(self._keys), handle)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary, 0o600)
            os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


class BridgeService:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.logger = configure_logging(config.log_dir)
        self.site = SiteClient(config, self.logger)
        self.adapter: IBKRAdapter | None = None
        self.alpaca = AlpacaAdapter(config, self.logger)
        self.yfinance = YFinanceAdapter(self.logger)
        self.stop_event = threading.Event()
        self.remote_kill_switch = False
        self.last_heartbeat = 0.0
        self.last_poll = 0.0
        self.last_reconnect_attempt = 0.0
        self.last_alpaca_sync = 0.0
        self.idempotency = LocalIdempotency(config.data_dir)
        try:
            if config.ibkr_connection_mode != "tws_api":
                raise RuntimeError("Only IBKR_CONNECTION_MODE=tws_api is supported by this bridge.")
            self.adapter = IBKRAdapter(config.ibkr_host, config.ibkr_port, config.ibkr_client_id, self.logger)
        except Exception as exc:
            self.logger.error("IBKR adapter unavailable: %s", exc)
            if config.trading_mode == "live":
                self.logger.critical("Live mode is disabled because the IBKR adapter could not start.")

    def run(self) -> None:
        self._install_signal_handlers()
        if self.adapter is not None:
            try:
                self.adapter.connect()
                self.logger.info("Connected to IBKR TWS API at %s:%s", self.config.ibkr_host, self.config.ibkr_port)
            except Exception as exc:
                self.logger.error("IBKR connection failed: %s", exc)

        try:
            while not self.stop_event.is_set():
                now = time.monotonic()
                self._ensure_ibkr_connection(now)
                if now - self.last_alpaca_sync >= self.config.alpaca_poll_interval_seconds:
                    self._sync_alpaca()
                    self.last_alpaca_sync = now
                if now - self.last_heartbeat >= self.config.heartbeat_interval_seconds:
                    self._send_heartbeat()
                    self.last_heartbeat = now
                if now - self.last_poll >= self.config.poll_interval_seconds:
                    self._poll_and_process()
                    self.last_poll = now
                self.stop_event.wait(0.25)
        finally:
            self._emergency_shutdown()
            self.site.close()
            self.alpaca.close()

    def _ensure_ibkr_connection(self, now: float) -> None:
        if self.adapter is None or self.adapter.health()["connected"] or now - self.last_reconnect_attempt < 15:
            return
        self.last_reconnect_attempt = now
        try:
            self.adapter.connect()
            self.logger.info("Reconnected to IBKR TWS API at %s:%s", self.config.ibkr_host, self.config.ibkr_port)
        except Exception as exc:
            self.logger.warning("IBKR reconnect failed: %s", exc)

    def _send_heartbeat(self) -> None:
        status = "unavailable"
        permissions: dict[str, Any] = {
            "event_contracts": "not_checked",
            "live_execution": "disabled_by_default" if not self.config.live_gate_configured else "guarded",
        }
        alpaca_health = self.alpaca.health()
        permissions["alpaca"] = "connected" if alpaca_health["enabled"] and not alpaca_health["last_error"] else "configured" if alpaca_health["configured"] else "disabled"
        permissions["alpaca_live_orders"] = "disabled_by_design"
        account_id = self.config.ibkr_account_id or None
        if self.adapter is not None:
            health = self.adapter.health()
            status = "connected" if health["connected"] else "stale"
            permissions["tws_api"] = "connected" if health["connected"] else "disconnected"
            permissions["event_catalog"] = "configured_specs" if self.config.event_contract_specs_json else "manual_specs_required"
            if health["last_error"]:
                permissions["last_error_code"] = health["last_error"].get("code")
            if health["connected"]:
                try:
                    account = self.adapter.account_snapshot()
                    if not account_id:
                        account_id = _first_account_id(account)
                    available = _account_value(account, "AvailableFunds")
                    if available is not None:
                        permissions["available_funds"] = available
                except Exception as exc:
                    self.logger.warning("Account heartbeat refresh failed: %s", exc)
        try:
            response = self.site.heartbeat(status, permissions, account_id, VERSION)
            self.remote_kill_switch = bool(response.get("killSwitch", False))
        except BridgeSecurityError as exc:
            self.logger.critical("security event: %s", exc)
            self.config = _disable_live(self.config)
        except Exception as exc:
            self.logger.warning("Heartbeat failed: %s", exc)

    def _poll_and_process(self) -> None:
        try:
            commands = self.site.poll_commands()
        except BridgeSecurityError as exc:
            self.logger.critical("security event: %s", exc)
            self.config = _disable_live(self.config)
            return
        except Exception as exc:
            self.logger.warning("Command poll failed: %s", exc)
            return
        for job in commands:
            try:
                self._process_job(job)
            except Exception as exc:
                self.logger.exception("Command processing failed for job %s", job.get("id"))
                self._report_failure(job, str(exc))

    def _sync_alpaca(self) -> None:
        if not self.config.alpaca_enabled:
            return
        snapshot = self.alpaca.sync()
        self.site.events([{"kind": "alpaca_snapshot", "snapshot": snapshot}])

    def _deep_research_stock(self, job_id: str, payload: dict[str, Any]) -> None:
        ticker = str(payload.get("ticker", "")).strip().upper()
        snapshot = self.yfinance.snapshot(ticker)
        self.site.events([{"kind": "stock_snapshot", "snapshot": snapshot}])
        self._complete(job_id)

    def _deep_research_competitors(self, job_id: str, payload: dict[str, Any]) -> None:
        tickers = payload.get("tickers") if isinstance(payload.get("tickers"), list) else []
        snapshots = self.yfinance.competitors([str(item) for item in tickers])
        self.site.events([{"kind": "competitor_snapshots", "snapshots": snapshots}])
        self._complete(job_id)

    def _process_job(self, job: dict[str, Any]) -> None:
        payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
        command = str(payload.get("command", ""))
        job_id = str(job.get("id", ""))
        if command == "kill_switch":
            self.remote_kill_switch = True
            cancelled = self.adapter.cancel_all_orders() if self.adapter is not None and self.adapter.health()["connected"] else []
            self.site.events([{"kind": "kill_switch_processed", "cancelled_broker_order_ids": cancelled}])
            self._complete(job_id)
            return
        if command == "reconcile":
            if self.adapter is None or not self.adapter.health()["connected"]:
                raise RuntimeError("IBKR adapter is unavailable for reconciliation.")
            reconciliation = self.adapter.reconcile()
            reconciliation["mode"] = self.config.trading_mode
            self.site.events([make_reconciliation_event(reconciliation)])
            self._complete(job_id)
            return
        if command == "discover_contract":
            if self.adapter is None or not self.adapter.health()["connected"]:
                raise RuntimeError("IBKR adapter is unavailable for contract discovery.")
            details = self.adapter.contract_details(dict(payload.get("contract", {})))
            self.site.events([{"kind": "contract_discovery", "details": details}])
            self._complete(job_id)
            return
        if command == "sync_catalog":
            self._sync_catalog(job_id)
            return
        if command == "sync_alpaca":
            self._sync_alpaca()
            self._complete(job_id)
            return
        if command == "deep_research_stock":
            self._deep_research_stock(job_id, payload)
            return
        if command == "deep_research_competitors":
            self._deep_research_competitors(job_id, payload)
            return
        if command == "place_order":
            self._place_order(job, payload)
            return
        raise RuntimeError(f"Unsupported bridge command: {command or '[missing]'}")

    def _sync_catalog(self, job_id: str) -> None:
        if self.adapter is None or not self.adapter.health()["connected"]:
            raise RuntimeError("IBKR adapter is unavailable for catalog sync.")
        try:
            specs = json.loads(self.config.event_contract_specs_json or "[]")
        except ValueError as exc:
            raise RuntimeError("IBKR_EVENT_CONTRACT_SPECS_JSON is not valid JSON.") from exc
        if not isinstance(specs, list) or not specs:
            raise RuntimeError("No explicit event-contract specs are configured. The TWS API event-contract scanner is unavailable; add specs from the user's IBKR catalog.")

        events: list[dict[str, Any]] = []
        for raw_spec in specs[:100]:
            if not isinstance(raw_spec, dict):
                continue
            spec = dict(raw_spec)
            details_list = self.adapter.contract_details(spec)
            if not details_list:
                events.append({"kind": "contract_discovery", "spec": spec, "status": "permission_unavailable", "details": {}})
                continue
            for details in details_list[:10]:
                outcome = str(spec.get("outcome") or ("YES" if str(details.get("right", "")).upper() == "C" else "NO")).upper()
                quote_payload = {
                    **spec,
                    "conid": details.get("conid"),
                    "symbol": details.get("symbol") or spec.get("symbol"),
                    "sec_type": details.get("sec_type") or spec.get("sec_type", "OPT"),
                    "exchange": details.get("exchange") or spec.get("exchange"),
                    "currency": details.get("currency") or spec.get("currency", "USD"),
                    "expiry": details.get("last_trade_date_or_contract_month") or spec.get("expiry", ""),
                    "strike": details.get("strike") or spec.get("strike", 0),
                    "outcome": outcome,
                    "trading_class": details.get("trading_class") or spec.get("trading_class", ""),
                    "local_symbol": details.get("local_symbol") or spec.get("local_symbol", ""),
                }
                quote: dict[str, Any] | None = None
                quote_error = ""
                try:
                    quote = self.adapter.quote(quote_payload)
                except Exception as exc:
                    quote_error = str(exc)
                    self.logger.warning("Quote refresh failed during catalog sync: %s", exc)
                events.append({
                    "kind": "contract_discovery",
                    "spec": spec,
                    "details": details,
                    "outcome": outcome,
                    "quote": quote,
                    "quote_error": quote_error,
                    "permission_status": "available",
                })
        self.site.events(events)
        self._complete(job_id)

    def _place_order(self, job: dict[str, Any], payload: dict[str, Any]) -> None:
        job_id = str(job.get("id", ""))
        order_id = str(payload.get("order_id", ""))
        order = dict(payload.get("order", {}))
        contract = dict(payload.get("contract", {}))
        order["asset_class"] = "stock" if str(contract.get("sec_type", "")).upper() == "STK" else "event"
        idempotency_key = str(payload.get("idempotency_key", f"order:{order_id}"))
        if self.idempotency.contains(idempotency_key):
            self.site.events([{"kind": "order_status", "order_id": order_id, "status": "duplicate", "reason": "Local idempotency key already processed."}])
            self._complete(job_id)
            return
        if self.adapter is None or not self.adapter.health()["connected"]:
            raise RuntimeError("IBKR adapter is unavailable.")
        if str(contract.get("sec_type", "")).upper() == "STK" and not contract.get("conid"):
            original_symbol = str(contract.get("symbol", "")).upper()
            contract["research_symbol"] = original_symbol
            suffix_exchange = {"DE": "IBIS", "L": "LSE", "PA": "SBF", "AS": "AEB", "MI": "BVME", "TO": "TSE", "HK": "SEHK", "SW": "EBS"}
            if "." in original_symbol:
                base, suffix = original_symbol.rsplit(".", 1)
                contract["symbol"] = base
                contract["exchange"] = suffix_exchange.get(suffix, contract.get("exchange", "SMART"))
            details = self.adapter.contract_details(contract)
            if details:
                resolved = details[0]
                contract.update({"conid": resolved.get("conid"), "exchange": resolved.get("exchange") or contract.get("exchange"), "trading_class": resolved.get("trading_class") or contract.get("trading_class"), "local_symbol": resolved.get("local_symbol") or contract.get("local_symbol")})
                self.site.events([{"kind": "stock_contract_discovery", "contract": contract, "details": resolved}])
        try:
            quote = self.adapter.quote(contract)
        except Exception as exc:
            if str(contract.get("sec_type", "")).upper() != "STK":
                raise
            # A paper TWS account may not have an enabled live market-data
            # subscription. Keep the order paper-only but use the real
            # yfinance snapshot as the approval-time risk quote.
            self.logger.warning("IBKR stock quote unavailable; using yfinance snapshot for risk validation: %s", exc)
            snapshot = self.yfinance.snapshot(str(contract.get("research_symbol") or contract.get("symbol", "")))
            last = snapshot.get("price")
            if not isinstance(last, (int, float)) or last <= 0:
                raise RuntimeError("Neither IBKR nor yfinance returned a usable stock quote.") from exc
            quote = {"bid": float(last), "ask": float(last), "last": float(last), "observed_at": snapshot.get("fetchedAt"), "source": snapshot.get("source")}
        account = self.adapter.account_snapshot()
        open_orders = len(self.adapter.open_orders_snapshot())
        guard_command = {
            **order,
            "asset_class": "stock" if str(contract.get("sec_type", "")).upper() == "STK" else "event",
            "approved": payload.get("approved") is True,
            "approval_expires_at": payload.get("approval_expires_at"),
            "max_entry_price": payload.get("max_entry_price"),
            "exchange": contract.get("exchange", ""),
        }
        try:
            validate_order_command(guard_command, quote, account, open_orders, self.config, self.remote_kill_switch, payload.get("risk_snapshot") if isinstance(payload.get("risk_snapshot"), dict) else None)
        except RiskGuardError as exc:
            self.site.events([{"kind": "order_status", "order_id": order_id, "status": "rejected", "reason": str(exc)}])
            self._complete(job_id, failed=True, reason=str(exc))
            return
        result = self.adapter.place_limit_order(contract, order)
        self.idempotency.add(idempotency_key)
        self.site.events([{"kind": "order_status", "order_id": order_id, "status": "submitted", "broker_order_id": result.get("broker_order_id"), "mode": self.config.trading_mode}])
        self._complete(job_id)

    def _complete(self, job_id: str, failed: bool = False, reason: str = "") -> None:
        self.site.events([{"kind": "job_status", "job_id": job_id, "status": "failed" if failed else "completed", "reason": reason}])

    def _report_failure(self, job: dict[str, Any], reason: str) -> None:
        job_id = str(job.get("id", ""))
        try:
            self.site.events([{"kind": "job_status", "job_id": job_id, "status": "failed", "reason": reason}])
        except Exception as exc:
            self.logger.error("Could not report bridge failure: %s", exc)

    def _emergency_shutdown(self) -> None:
        if self.adapter is not None:
            try:
                health = self.adapter.health()
                if health["connected"] and self.config.live_gate_configured:
                    cancelled = self.adapter.cancel_all_orders()
                    self.logger.critical("Emergency shutdown cancelled broker orders: %s", cancelled)
            except Exception as exc:
                self.logger.critical("Emergency shutdown could not cancel orders: %s", exc)
            try:
                self.adapter.disconnect()
            except Exception:
                pass

    def _install_signal_handlers(self) -> None:
        signal.signal(signal.SIGINT, lambda _signum, _frame: self.stop_event.set())
        signal.signal(signal.SIGTERM, lambda _signum, _frame: self.stop_event.set())


def _account_value(account: dict[str, Any], key: str) -> float | None:
    value = account.get(key)
    if isinstance(value, dict):
        value = value.get("value")
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _first_account_id(account: dict[str, Any]) -> str | None:
    for value in account.values():
        if isinstance(value, dict) and value.get("account"):
            return str(value["account"])
    return None


def _disable_live(config: Config) -> Config:
    return Config(**{**config.__dict__, "trading_mode": "paper", "live_trading_enabled": False})


def main() -> int:
    load_dotenv()
    config = Config.from_env()
    logger = configure_logging(config.log_dir)
    if "--health-check" in sys.argv:
        logger.info("Paper-mode bridge health check passed: configuration parsed and process dependencies are importable.")
        return 0
    if not config.site_base_url or not config.bridge_token:
        logger.critical("SITE_BASE_URL and BRIDGE_TOKEN are required. Live mode will not start.")
        return 2
    if config.trading_mode == "live" and not config.live_gate_configured:
        logger.critical("Live mode refused: explicit bridge gates are incomplete.")
        return 2
    BridgeService(config).run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
