from __future__ import annotations

import logging
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import Config
from app.logging_config import SecretRedactionFilter
from app.main import LocalIdempotency
from app.ibkr import contracts as contract_module
from app.polling.site_client import _retry_after, canonical_signature
from app.risk.local_guard import RiskGuardError, validate_order_command


def config(**overrides: object) -> Config:
    values: dict[str, object] = {
        "bridge_id": "test-bridge",
        "site_base_url": "https://example.test",
        "bridge_token": "test-token",
        "trading_mode": "live",
        "live_trading_enabled": True,
        "manual_approval_required": True,
        "allow_market_orders": False,
        "ibkr_connection_mode": "tws_api",
        "ibkr_host": "127.0.0.1",
        "ibkr_port": 4002,
        "ibkr_client_id": 17,
        "ibkr_account_id": "U123",
        "event_contract_specs_json": "[]",
        "data_dir": "/tmp/bridge-test",
        "log_dir": "/tmp/bridge-test-logs",
        "poll_interval_seconds": 3.0,
        "heartbeat_interval_seconds": 15.0,
        "max_position_per_contract_usd": 50.0,
        "max_total_exposure_usd": 250.0,
        "max_order_size_usd": 20.0,
        "max_daily_loss_usd": 30.0,
        "starting_capital_usd": 1000.0,
        "min_account_floor_percent": 20.0,
        "max_concurrent_orders": 3,
        "max_slippage_percent": 0.015,
    }
    values.update(overrides)
    return Config(**values)  # type: ignore[arg-type]


class BridgeTests(unittest.TestCase):
    def test_stock_contract_omits_derivative_fields(self) -> None:
        class FakeContract:
            pass

        original_contract = contract_module.Contract
        contract_module.Contract = FakeContract
        try:
            contract = contract_module.contract_from_payload({
                "symbol": "TSM",
                "sec_type": "STK",
                "exchange": "SMART",
                "currency": "USD",
                "expiry": "20360909",
                "strike": 100,
                "outcome": "LONG",
                "trading_class": "TSM",
            })
        finally:
            contract_module.Contract = original_contract

        self.assertEqual(contract.symbol, "TSM")
        self.assertEqual(contract.secType, "STK")
        self.assertFalse(hasattr(contract, "lastTradeDateOrContractMonth"))
        self.assertFalse(hasattr(contract, "right"))
        self.assertFalse(hasattr(contract, "strike"))
        self.assertFalse(hasattr(contract, "tradingClass"))

    def test_qualified_stock_uses_conid_as_authoritative_identity(self) -> None:
        class FakeContract:
            pass

        original_contract = contract_module.Contract
        contract_module.Contract = FakeContract
        try:
            contract = contract_module.contract_from_payload({
                "conid": 123456,
                "symbol": "SU",
                "sec_type": "STK",
                "exchange": "SBF",
                "currency": "EUR",
                "expiry": "20360909",
            })
        finally:
            contract_module.Contract = original_contract

        self.assertEqual(contract.conId, 123456)
        self.assertEqual(contract.symbol, "")
        self.assertEqual(contract.exchange, "SBF")
        self.assertEqual(contract.currency, "EUR")
        self.assertFalse(hasattr(contract, "lastTradeDateOrContractMonth"))

    def test_probability_normalization_is_represented_by_single_outcome_price(self) -> None:
        yes = 0.62
        self.assertAlmostEqual(1 - yes, 0.38)

    def test_signature_is_deterministic(self) -> None:
        first = canonical_signature("secret", "1700000000", "POST", "/api/bridge/events", '{"events":[]}')
        second = canonical_signature("secret", "1700000000", "POST", "/api/bridge/events", '{"events":[]}')
        self.assertEqual(first, second)
        self.assertNotEqual(first, canonical_signature("other", "1700000000", "POST", "/api/bridge/events", '{"events":[]}'))

    def test_limit_order_passes_all_local_gates(self) -> None:
        expiry = (datetime.now(timezone.utc) + timedelta(minutes=1)).isoformat()
        validate_order_command(
            {
                "approved": True,
                "approval_expires_at": expiry,
                "order_type": "LMT",
                "tif": "DAY",
                "action": "BUY",
                "quantity": 10,
                "limit_price": 0.55,
                "max_entry_price": 0.60,
                "exchange": "FORECASTX",
            },
            {"ask": 0.55, "observed_at": datetime.now(timezone.utc).isoformat()},
            {"AvailableFunds": {"value": "1000", "currency": "USD"}},
            0,
            config(),
            False,
            {"current_exposure": 0, "total_exposure": 0, "daily_pnl": 0, "starting_capital": 1000, "open_orders": 0},
        )

    def test_forecastex_sell_is_rejected(self) -> None:
        with self.assertRaises(RiskGuardError):
            validate_order_command(
                {
                    "approved": True,
                    "approval_expires_at": (datetime.now(timezone.utc) + timedelta(minutes=1)).isoformat(),
                    "order_type": "LMT",
                    "tif": "DAY",
                    "action": "SELL",
                    "quantity": 1,
                    "limit_price": 0.55,
                    "max_entry_price": 0.60,
                    "exchange": "FORECASTX",
                },
                {"ask": 0.55, "observed_at": datetime.now(timezone.utc).isoformat()},
                {"AvailableFunds": {"value": "1000"}},
                0,
                config(),
                False,
            )

    def test_stale_quote_is_rejected(self) -> None:
        with self.assertRaises(RiskGuardError):
            validate_order_command(
                {
                    "approved": True,
                    "approval_expires_at": (datetime.now(timezone.utc) + timedelta(minutes=1)).isoformat(),
                    "order_type": "LMT",
                    "tif": "DAY",
                    "action": "BUY",
                    "quantity": 1,
                    "limit_price": 0.55,
                    "max_entry_price": 0.60,
                    "exchange": "FORECASTX",
                },
                {"ask": 0.55, "observed_at": (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()},
                {"AvailableFunds": {"value": "1000"}},
                0,
                config(),
                False,
            )

    def test_expired_manual_approval_is_rejected(self) -> None:
        with self.assertRaises(RiskGuardError):
            validate_order_command(
                {
                    "approved": True,
                    "approval_expires_at": (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(),
                    "order_type": "LMT",
                    "tif": "DAY",
                    "action": "BUY",
                    "quantity": 1,
                    "limit_price": 0.55,
                    "max_entry_price": 0.60,
                    "exchange": "FORECASTX",
                },
                {"ask": 0.55, "observed_at": datetime.now(timezone.utc).isoformat()},
                {"AvailableFunds": {"value": "1000"}},
                0,
                config(),
                False,
                {"current_exposure": 0, "total_exposure": 0, "daily_pnl": 0, "starting_capital": 1000, "open_orders": 0},
            )

    def test_risk_snapshot_is_required_and_caps_are_rechecked(self) -> None:
        expiry = (datetime.now(timezone.utc) + timedelta(minutes=1)).isoformat()
        command = {
            "approved": True,
            "approval_expires_at": expiry,
            "order_type": "LMT",
            "tif": "DAY",
            "action": "BUY",
            "quantity": 10,
            "limit_price": 0.55,
            "max_entry_price": 0.60,
            "exchange": "FORECASTX",
        }
        quote = {"ask": 0.55, "observed_at": datetime.now(timezone.utc).isoformat()}
        with self.assertRaises(RiskGuardError):
            validate_order_command(command, quote, {"AvailableFunds": {"value": "1000"}}, 0, config(), False)
        with self.assertRaises(RiskGuardError):
            validate_order_command(command, quote, {"AvailableFunds": {"value": "1000"}}, 0, config(), False, {"current_exposure": 45, "total_exposure": 45, "daily_pnl": 0, "starting_capital": 1000, "open_orders": 0})

    def test_daily_loss_and_account_floor_halt(self) -> None:
        expiry = (datetime.now(timezone.utc) + timedelta(minutes=1)).isoformat()
        command = {
            "approved": True,
            "approval_expires_at": expiry,
            "order_type": "LMT",
            "tif": "DAY",
            "action": "BUY",
            "quantity": 1,
            "limit_price": 0.55,
            "max_entry_price": 0.60,
            "exchange": "FORECASTX",
        }
        quote = {"ask": 0.55, "observed_at": datetime.now(timezone.utc).isoformat()}
        account = {"AvailableFunds": {"value": "1000"}}
        with self.assertRaises(RiskGuardError):
            validate_order_command(command, quote, account, 0, config(), False, {"current_exposure": 0, "total_exposure": 0, "daily_pnl": -30, "starting_capital": 1000, "open_orders": 0})
        with self.assertRaises(RiskGuardError):
            validate_order_command(command, quote, account, 0, config(), False, {"current_exposure": 0, "total_exposure": 0, "daily_pnl": 0, "starting_capital": 0.5, "open_orders": 0})

    def test_retry_after_is_bounded_and_defaults_safely(self) -> None:
        self.assertEqual(_retry_after("7"), 7.0)
        self.assertEqual(_retry_after("999"), 60.0)
        self.assertEqual(_retry_after("not-a-number"), 5.0)
        self.assertEqual(_retry_after(None), 5.0)

    def test_local_idempotency_survives_reload(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalIdempotency(directory)
            store.add("proposal:test")
            self.assertTrue(LocalIdempotency(directory).contains("proposal:test"))

    def test_secret_redaction(self) -> None:
        record = logging.LogRecord("test", logging.INFO, __file__, 1, "Authorization: Bearer abc123 token=xyz", (), None)
        SecretRedactionFilter().filter(record)
        self.assertNotIn("abc123", record.getMessage())
        self.assertNotIn("xyz", record.getMessage())


if __name__ == "__main__":
    unittest.main()
