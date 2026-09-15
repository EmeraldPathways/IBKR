from __future__ import annotations

from typing import Any

try:
    from ibapi.order import Order
except ImportError:  # pragma: no cover
    Order = None  # type: ignore[assignment,misc]


ALLOWED_TIFS = {"DAY", "GTC", "IOC"}


def build_limit_order(payload: dict[str, Any]) -> Any:
    if Order is None:
        raise RuntimeError("The official IBKR Python TWS API package is not installed.")
    order_type = str(payload.get("order_type", "LMT")).upper()
    if order_type != "LMT":
        raise ValueError("Event-contract orders must use LMT.")
    tif = str(payload.get("tif", "DAY")).upper()
    if tif not in ALLOWED_TIFS:
        raise ValueError("Event-contract TIF must be DAY, GTC or IOC.")
    action = str(payload.get("action", "BUY")).upper()
    if action not in {"BUY", "SELL"}:
        raise ValueError("Order action must be BUY or SELL.")
    quantity = float(payload.get("quantity", 0))
    if quantity <= 0 or (str(payload.get("asset_class", "event")).lower() != "stock" and quantity != int(quantity)):
        raise ValueError("Quantity must be positive; event contracts require whole units.")
    limit_price = float(payload.get("limit_price", 0))
    if limit_price <= 0:
        raise ValueError("A positive limit price is required.")

    order = Order()
    order.action = action
    order.orderType = "LMT"
    order.totalQuantity = quantity if str(payload.get("asset_class", "event")).lower() == "stock" else int(quantity)
    order.lmtPrice = limit_price
    order.tif = tif
    return order
