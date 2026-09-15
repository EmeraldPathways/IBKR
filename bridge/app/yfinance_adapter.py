from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


class YFinanceAdapter:
    """Read-only yfinance adapter for Deep Research.

    This module never submits orders. It is deliberately isolated from the
    IBKR adapter so stock research cannot gain broker execution privileges.
    """

    def __init__(self, logger: Any) -> None:
        self.logger = logger

    @staticmethod
    def _value(info: dict[str, Any], *keys: str) -> Any:
        for key in keys:
            value = info.get(key)
            if value is not None:
                return value
        return None

    def snapshot(self, ticker: str) -> dict[str, Any]:
        import yfinance as yf

        symbol = ticker.strip().upper()
        if not symbol or len(symbol) > 20:
            raise ValueError("Invalid ticker")
        asset = yf.Ticker(symbol)
        info = dict(asset.info or {})
        history = asset.history(period="1y", interval="1d", auto_adjust=False, actions=False)
        if history.empty and self._value(info, "regularMarketPrice", "currentPrice") is None:
            raise ValueError(f"Ticker not found or has no market data: {symbol}")
        rows: list[dict[str, Any]] = []
        for index, row in history.iterrows():
            close = row.get("Close")
            if close is None:
                continue
            try:
                rows.append({"date": index.strftime("%Y-%m-%d"), "close": float(close)})
            except (TypeError, ValueError):
                continue
        currency = str(self._value(info, "currency") or "USD").upper()
        price = self._value(info, "currentPrice", "regularMarketPrice")
        previous = self._value(info, "regularMarketPreviousClose", "previousClose")
        change_percent = self._value(info, "regularMarketChangePercent")
        if change_percent is None and price is not None and previous:
            change_percent = (float(price) / float(previous) - 1) * 100
        market_cap = self._value(info, "marketCap")
        return {
            "ticker": symbol,
            "name": str(self._value(info, "longName", "shortName") or symbol),
            "currency": currency,
            "price": self._float(price),
            "changePercent": self._float(change_percent),
            "high52": self._float(self._value(info, "fiftyTwoWeekHigh")),
            "low52": self._float(self._value(info, "fiftyTwoWeekLow")),
            "marketCap": self._float(market_cap),
            "marketCapUsd": self._float(market_cap) if currency == "USD" else None,
            "sector": self._value(info, "sector"),
            "industry": self._value(info, "industry"),
            "pe": self._float(self._value(info, "trailingPE")),
            "forwardPe": self._float(self._value(info, "forwardPE")),
            "peg": self._float(self._value(info, "pegRatio")),
            "eps": self._float(self._value(info, "trailingEps")),
            "forwardEps": self._float(self._value(info, "forwardEps")),
            "profitMargin": self._float(self._value(info, "profitMargins")),
            "revenueGrowth": self._float(self._value(info, "revenueGrowth")),
            "earningsGrowth": self._float(self._value(info, "earningsGrowth")),
            "beta": self._float(self._value(info, "beta")),
            "debtEquity": self._float(self._value(info, "debtToEquity")),
            "dividendYield": self._float(self._value(info, "dividendYield")),
            "analystBuy": int(self._value(info, "analystRatingBuy") or 0),
            "analystHold": int(self._value(info, "analystRatingHold") or 0),
            "analystSell": int(self._value(info, "analystRatingSell") or 0),
            "meanTarget": self._float(self._value(info, "targetMeanPrice")),
            "history": rows,
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
            "source": "yfinance via Windows bridge",
        }

    def competitors(self, tickers: list[str]) -> list[dict[str, Any]]:
        return [self.snapshot(ticker) for ticker in tickers[:2]]

    @staticmethod
    def _float(value: Any) -> float | None:
        try:
            result = float(value)
            return result if result == result else None
        except (TypeError, ValueError):
            return None
