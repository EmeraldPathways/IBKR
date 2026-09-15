from __future__ import annotations

from typing import Any

import httpx

from ..config import Config


class AlpacaAdapter:
    """Official Alpaca REST connector. It intentionally never submits orders."""

    def __init__(self, config: Config, logger: Any) -> None:
        self.config = config
        self.logger = logger
        self.http = httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0), follow_redirects=False)
        self.last_error: str | None = None
        self.last_sync: str | None = None

    def close(self) -> None:
        self.http.close()

    def enabled(self) -> bool:
        return self.config.alpaca_enabled and bool(self.config.alpaca_api_key and self.config.alpaca_api_secret)

    def health(self) -> dict[str, Any]:
        return {"enabled": self.enabled(), "configured": bool(self.config.alpaca_api_key and self.config.alpaca_api_secret), "last_error": self.last_error, "live_orders": False}

    def sync(self) -> dict[str, Any]:
        if not self.enabled():
            return {"status": "disabled", "paper_only": True, "live_orders": False}
        try:
            account = self._get(self.config.alpaca_trading_base_url, "/v2/account")
            positions = self._get(self.config.alpaca_trading_base_url, "/v2/positions")
            orders = self._get(self.config.alpaca_trading_base_url, "/v2/orders", {"status": "open", "limit": 100, "nested": "true"})
            snapshots: dict[str, Any] = {}
            if self.config.alpaca_symbols:
                snapshots = self._get(self.config.alpaca_data_base_url, "/v2/stocks/snapshots", {"symbols": ",".join(self.config.alpaca_symbols), "feed": self.config.alpaca_data_feed})
            crypto = {}
            if self.config.alpaca_crypto_symbols:
                crypto = self._get(self.config.alpaca_data_base_url, "/v1beta3/crypto/us/snapshots", {"symbols": ",".join(self.config.alpaca_crypto_symbols)})
            news = self._get(self.config.alpaca_data_base_url, "/v1beta1/news", {"symbols": ",".join(self.config.alpaca_news_symbols), "limit": 20}) if self.config.alpaca_news_symbols else {"news": []}
            self.last_error = None
            return {"status": "connected", "paper_only": not self.config.alpaca_live_trading_enabled, "live_orders": False, "account": _account(account), "positions": _list(positions), "orders": _list(orders), "snapshots": _snapshots(snapshots, "us_equity"), "crypto_snapshots": _snapshots(crypto, "crypto"), "news": _news(news)}
        except Exception as exc:
            self.last_error = str(exc)[:240]
            self.logger.warning("Alpaca sync failed: %s", exc)
            return {"status": "unavailable", "paper_only": True, "live_orders": False, "error": self.last_error}

    def _get(self, base: str, path: str, params: dict[str, Any] | None = None) -> Any:
        response = self.http.get(f"{base}{path}", params=params, headers={"APCA-API-KEY-ID": self.config.alpaca_api_key, "APCA-API-SECRET-KEY": self.config.alpaca_api_secret, "Accept": "application/json"})
        if response.status_code in {401, 403}:
            raise RuntimeError(f"Alpaca authentication or permission error HTTP {response.status_code}")
        if response.status_code == 429:
            raise RuntimeError("Alpaca rate limit reached; sync will retry on the next scheduled poll")
        response.raise_for_status()
        return response.json()


def _list(value: Any) -> list[dict[str, Any]]:
    return value if isinstance(value, list) else []


def _account(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict): return {}
    return {key: value.get(key) for key in ("id", "status", "currency", "cash", "equity", "buying_power", "portfolio_value", "last_equity")}


def _snapshots(value: Any, asset_class: str) -> list[dict[str, Any]]:
    if not isinstance(value, dict): return []
    result = []
    for symbol, raw in value.items():
        if not isinstance(raw, dict): continue
        quote = raw.get("latestQuote") or raw.get("latest_quote") or {}
        trade = raw.get("latestTrade") or raw.get("latest_trade") or {}
        result.append({"symbol": symbol, "asset_class": asset_class, "bid": quote.get("bp"), "ask": quote.get("ap"), "bid_size": quote.get("bs"), "ask_size": quote.get("as"), "last_price": trade.get("p"), "observed_at": trade.get("t") or quote.get("t")})
    return result


def _news(value: Any) -> list[dict[str, Any]]:
    items = value.get("news", []) if isinstance(value, dict) else []
    return [{"id": item.get("id"), "headline": item.get("headline"), "url": item.get("url"), "source": item.get("source", "Alpaca/Benzinga"), "published_at": item.get("created_at") or item.get("updated_at") or item.get("timestamp")} for item in items if isinstance(item, dict)]
