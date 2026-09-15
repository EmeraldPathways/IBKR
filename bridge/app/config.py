from __future__ import annotations

import os
from dataclasses import dataclass


def _bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class Config:
    bridge_id: str
    site_base_url: str
    bridge_token: str
    trading_mode: str
    live_trading_enabled: bool
    manual_approval_required: bool
    allow_market_orders: bool
    ibkr_connection_mode: str
    ibkr_host: str
    ibkr_port: int
    ibkr_client_id: int
    ibkr_account_id: str
    event_contract_specs_json: str
    data_dir: str
    log_dir: str
    poll_interval_seconds: float
    heartbeat_interval_seconds: float
    max_position_per_contract_usd: float
    max_total_exposure_usd: float
    max_order_size_usd: float
    max_daily_loss_usd: float
    starting_capital_usd: float
    min_account_floor_percent: float
    max_concurrent_orders: int
    max_slippage_percent: float
    alpaca_enabled: bool = False
    alpaca_api_key: str = ""
    alpaca_api_secret: str = ""
    alpaca_trading_base_url: str = "https://paper-api.alpaca.markets"
    alpaca_data_base_url: str = "https://data.alpaca.markets"
    alpaca_data_feed: str = "iex"
    alpaca_symbols: tuple[str, ...] = ()
    alpaca_crypto_symbols: tuple[str, ...] = ()
    alpaca_news_symbols: tuple[str, ...] = ()
    alpaca_poll_interval_seconds: float = 30.0
    alpaca_live_trading_enabled: bool = False

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            bridge_id=os.getenv("BRIDGE_ID", "local-ibkr-bridge"),
            site_base_url=os.getenv("SITE_BASE_URL", "").rstrip("/"),
            bridge_token=os.getenv("BRIDGE_TOKEN", ""),
            trading_mode=os.getenv("TRADING_MODE", "paper").lower(),
            live_trading_enabled=_bool("LIVE_TRADING_ENABLED"),
            manual_approval_required=_bool("MANUAL_APPROVAL_REQUIRED", True),
            allow_market_orders=_bool("ALLOW_MARKET_ORDERS"),
            ibkr_connection_mode=os.getenv("IBKR_CONNECTION_MODE", "tws_api").lower(),
            ibkr_host=os.getenv("IBKR_HOST", "127.0.0.1"),
            ibkr_port=_int("IBKR_PORT", 4002),
            ibkr_client_id=_int("IBKR_CLIENT_ID", 17),
            ibkr_account_id=os.getenv("IBKR_ACCOUNT_ID", ""),
            event_contract_specs_json=os.getenv("IBKR_EVENT_CONTRACT_SPECS_JSON", ""),
            data_dir=os.getenv("DATA_DIR", "/var/lib/ibkr-bridge"),
            log_dir=os.getenv("LOG_DIR", "/var/log/ibkr-bridge"),
            poll_interval_seconds=_float("POLL_INTERVAL_SECONDS", 3.0),
            heartbeat_interval_seconds=_float("HEARTBEAT_INTERVAL_SECONDS", 15.0),
            max_position_per_contract_usd=_float("MAX_POSITION_PER_CONTRACT_USD", 50.0),
            max_total_exposure_usd=_float("MAX_TOTAL_EXPOSURE_USD", 250.0),
            max_order_size_usd=_float("MAX_ORDER_SIZE_USD", 20.0),
            max_daily_loss_usd=_float("MAX_DAILY_LOSS_USD", 30.0),
            starting_capital_usd=_float("STARTING_CAPITAL_USD", 1000.0),
            min_account_floor_percent=_float("MIN_ACCOUNT_FLOOR_PERCENT", 20.0),
            max_concurrent_orders=_int("MAX_CONCURRENT_ORDERS", 3),
            max_slippage_percent=_float("MAX_SLIPPAGE_PERCENT", 0.015),
            alpaca_enabled=_bool("ALPACA_ENABLED"),
            alpaca_api_key=os.getenv("ALPACA_API_KEY", ""),
            alpaca_api_secret=os.getenv("ALPACA_API_SECRET", ""),
            alpaca_trading_base_url=os.getenv("ALPACA_TRADING_BASE_URL", "https://paper-api.alpaca.markets").rstrip("/"),
            alpaca_data_base_url=os.getenv("ALPACA_DATA_BASE_URL", "https://data.alpaca.markets").rstrip("/"),
            alpaca_data_feed=os.getenv("ALPACA_DATA_FEED", "iex"),
            alpaca_symbols=tuple(item.strip().upper() for item in os.getenv("ALPACA_SYMBOLS", "SPY,QQQ,TLT,GLD").split(",") if item.strip()),
            alpaca_crypto_symbols=tuple(item.strip().upper() for item in os.getenv("ALPACA_CRYPTO_SYMBOLS", "").split(",") if item.strip()),
            alpaca_news_symbols=tuple(item.strip().upper() for item in os.getenv("ALPACA_NEWS_SYMBOLS", "SPY,QQQ").split(",") if item.strip()),
            alpaca_poll_interval_seconds=_float("ALPACA_POLL_INTERVAL_SECONDS", 30.0),
            alpaca_live_trading_enabled=_bool("ALPACA_LIVE_TRADING_ENABLED"),
        )

    @property
    def live_gate_configured(self) -> bool:
        return self.trading_mode == "live" and self.live_trading_enabled and bool(self.bridge_token) and self.ibkr_connection_mode == "tws_api"
