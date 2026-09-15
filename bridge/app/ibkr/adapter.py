from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Any

from .contracts import contract_details_to_dict, contract_from_payload
from .orders import build_limit_order

try:
    from ibapi.client import EClient
    from ibapi.wrapper import EWrapper
except ImportError as import_error:  # pragma: no cover - setup diagnostics handle this path
    EClient = None  # type: ignore[assignment,misc]
    EWrapper = None  # type: ignore[assignment,misc]
    IBAPI_IMPORT_ERROR = import_error
else:
    IBAPI_IMPORT_ERROR = None


class _CallbackWrapper:
    def __init__(self, owner: "IBKRAdapter") -> None:
        self.owner = owner


if EWrapper is not None:

    class _OfficialWrapper(EWrapper):  # type: ignore[misc,valid-type]
        def __init__(self, owner: "IBKRAdapter") -> None:
            super().__init__()
            self.owner = owner

        def nextValidId(self, orderId: int) -> None:
            self.owner._next_valid_id(orderId)

        def error(self, reqId: int, *args: Any) -> None:
            """Handle both current and legacy IBKR Python API callbacks.

            Current API releases call error(reqId, errorTime, errorCode,
            errorString, advancedOrderRejectJson). Older releases omit
            errorTime. Keeping the compatibility shim here prevents the
            timestamp from being recorded as the error code.
            """
            if len(args) >= 3 and isinstance(args[1], (int, float)):
                error_time, error_code, error_string = args[:3]
                advanced = args[3] if len(args) >= 4 else ""
            elif len(args) >= 2:
                error_time, error_code, error_string = None, args[0], args[1]
                advanced = args[2] if len(args) >= 3 else ""
            else:
                error_time, error_code, error_string, advanced = None, 0, str(args[0]) if args else "Unknown IBKR error", ""
            self.owner._error(reqId, int(error_code), str(error_string), str(advanced or ""), error_time)

        def connectionClosed(self) -> None:
            self.owner._connection_closed()

        def contractDetails(self, reqId: int, contractDetails: Any) -> None:
            self.owner._contract_details(reqId, contractDetails)

        def contractDetailsEnd(self, reqId: int) -> None:
            self.owner._finish(reqId)

        def tickPrice(self, reqId: int, tickType: int, price: float, attrib: Any) -> None:
            self.owner._tick_price(reqId, tickType, price)

        def tickSize(self, reqId: int, tickType: int, size: int) -> None:
            self.owner._tick_size(reqId, tickType, size)

        def tickSnapshotEnd(self, reqId: int) -> None:
            self.owner._finish(reqId)

        def accountSummary(self, reqId: int, account: str, tag: str, value: str, currency: str) -> None:
            self.owner._account_summary(reqId, account, tag, value, currency)

        def accountSummaryEnd(self, reqId: int) -> None:
            self.owner._account_summary_end(reqId)

        def position(self, account: str, contract: Any, position: float, avgCost: float) -> None:
            self.owner._position(account, contract, position, avgCost)

        def positionEnd(self) -> None:
            self.owner._finish_global("positions")

        def openOrder(self, orderId: int, contract: Any, order: Any, orderState: Any) -> None:
            self.owner._open_order(orderId, contract, order, orderState)

        def orderStatus(self, orderId: int, status: str, filled: float, remaining: float, avgFillPrice: float, permId: int, parentId: int, lastFillPrice: float, clientId: int, whyHeld: str, mktCapPrice: float = 0.0) -> None:
            self.owner._order_status(orderId, status, filled, remaining, avgFillPrice, lastFillPrice)

        def openOrderEnd(self) -> None:
            self.owner._finish_global("open_orders")

else:

    class _OfficialWrapper(_CallbackWrapper):
        pass


class IBKRAdapter:
    """Small synchronous facade over the official IBKR Python TWS API.

    The TWS API owns the local socket connection between this process and
    Trader Workstation or IB Gateway. The hosted Site never sees that socket.
    """

    def __init__(self, host: str, port: int, client_id: int, logger: Any) -> None:
        if IBAPI_IMPORT_ERROR is not None or EClient is None:
            raise RuntimeError("Install the official IBKR TWS API Python package before starting the bridge.") from IBAPI_IMPORT_ERROR
        self.logger = logger
        self.wrapper = _OfficialWrapper(self)
        self.client = EClient(self.wrapper)
        self.host = host
        self.port = port
        self.client_id = client_id
        self._thread: threading.Thread | None = None
        self._connected = threading.Event()
        self._next_order_id: int | None = None
        self._next_order_event = threading.Event()
        self._request_id = 10_000
        self._request_lock = threading.Lock()
        # IBKR permits only a small number of simultaneous account-summary
        # subscriptions.  Serialise reconciliation requests so a heartbeat
        # and a command cannot open overlapping subscriptions.
        self._account_summary_lock = threading.Lock()
        # reqAccountSummary creates a long-lived subscription.  Keep one
        # subscription for the lifetime of this connection rather than
        # opening a new subscription on every heartbeat.
        self._account_summary_req_id: int | None = None
        self._account_summary_event = threading.Event()
        self._account_summary_values: dict[str, dict[str, str]] = {}
        self._account_summary_error: dict[str, Any] | None = None
        self._order_lock = threading.Lock()
        self._requests: dict[int, dict[str, Any]] = {}
        self._global_events: dict[str, threading.Event] = defaultdict(threading.Event)
        self._last_errors: deque[dict[str, Any]] = deque(maxlen=50)
        self._last_error_at: str | None = None

    def connect(self, timeout: float = 12.0) -> None:
        if self.client.isConnected():
            return
        self.client.connect(self.host, self.port, self.client_id)
        self._thread = threading.Thread(target=self.client.run, name="ibkr-tws-reader", daemon=True)
        self._thread.start()
        if not self._connected.wait(timeout):
            raise TimeoutError("IBKR TWS API did not provide nextValidId before the connection timeout.")

    def disconnect(self) -> None:
        self._close_account_summary_subscription()
        if self.client.isConnected():
            self.client.disconnect()
        self._connected.clear()

    def health(self) -> dict[str, Any]:
        return {
            "connected": bool(self.client.isConnected() and self._connected.is_set()),
            "last_error": self._last_errors[-1] if self._last_errors else None,
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }

    def account_snapshot(self) -> dict[str, Any]:
        """Return the latest values from one persistent IBKR subscription."""
        with self._account_summary_lock:
            if self._account_summary_req_id is None:
                req_id = self._new_request_id()
                self._account_summary_req_id = req_id
                self._account_summary_values = {}
                self._account_summary_error = None
                self._account_summary_event.clear()
                self.client.reqAccountSummary(
                    req_id,
                    "All",
                    "NetLiquidation,TotalCashValue,AvailableFunds,BuyingPower",
                )
            if not self._account_summary_event.wait(8.0):
                self._close_account_summary_subscription()
                raise TimeoutError("IBKR account summary did not complete within 8 seconds.")
            if self._account_summary_error is not None:
                error = self._account_summary_error
                self._close_account_summary_subscription()
                raise RuntimeError(error["message"])
            return {key: dict(value) for key, value in self._account_summary_values.items()}

    def _close_account_summary_subscription(self) -> None:
        req_id = self._account_summary_req_id
        self._account_summary_req_id = None
        self._account_summary_event.clear()
        self._account_summary_values = {}
        self._account_summary_error = None
        if req_id is not None:
            try:
                if self.client.isConnected():
                    self.client.cancelAccountSummary(req_id)
            except Exception as exc:
                self.logger.debug("Unable to cancel account summary subscription %s: %s", req_id, exc)

    def positions_snapshot(self) -> list[dict[str, Any]]:
        self._start_global("positions")
        self.client.reqPositions()
        self._global_events["positions"].wait(8.0)
        self.client.cancelPositions()
        return getattr(self, "_positions_buffer", [])

    def open_orders_snapshot(self) -> list[dict[str, Any]]:
        self._start_global("open_orders")
        self.client.reqOpenOrders()
        self._global_events["open_orders"].wait(8.0)
        return list(getattr(self, "_open_orders_buffer", {}).values())

    def contract_details(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        contract = contract_from_payload(payload)
        req_id = self._start_request("contract_details")
        self.client.reqContractDetails(req_id, contract)
        result = self._wait_request(req_id, timeout=8.0)
        return result.get("details", [])

    def quote(self, payload: dict[str, Any]) -> dict[str, Any]:
        contract = contract_from_payload(payload)
        req_id = self._start_request("quote")
        self.client.reqMktData(req_id, contract, "", True, False, [])
        result = self._wait_request(req_id, timeout=4.0)
        self.client.cancelMktData(req_id)
        quote = result.get("quote", {})
        quote["observed_at"] = datetime.now(timezone.utc).isoformat()
        quote["conid"] = int(getattr(contract, "conId", 0) or 0)
        return quote

    def place_limit_order(self, contract_payload: dict[str, Any], order_payload: dict[str, Any]) -> dict[str, Any]:
        contract = contract_from_payload(contract_payload)
        order = build_limit_order(order_payload)
        with self._order_lock:
            if self._next_order_id is None:
                self._next_order_event.wait(8.0)
            if self._next_order_id is None:
                raise RuntimeError("IBKR has not supplied a valid order ID.")
            order_id = self._next_order_id
            self._next_order_id += 1
            self.client.placeOrder(order_id, contract, order)
        return {"broker_order_id": str(order_id), "order_id": order_id, "status": "submitted"}

    def cancel_order(self, broker_order_id: str) -> None:
        self.client.cancelOrder(int(broker_order_id), "")

    def cancel_all_orders(self) -> list[str]:
        orders = self.open_orders_snapshot()
        cancelled: list[str] = []
        for row in orders:
            broker_order_id = row.get("broker_order_id")
            if broker_order_id is None:
                continue
            self.cancel_order(str(broker_order_id))
            cancelled.append(str(broker_order_id))
        return cancelled

    def reconcile(self) -> dict[str, Any]:
        return {
            "account": self.account_snapshot(),
            "positions": self.positions_snapshot(),
            "open_orders": self.open_orders_snapshot(),
            "observed_at": datetime.now(timezone.utc).isoformat(),
        }

    def _new_request_id(self) -> int:
        with self._request_lock:
            self._request_id += 1
            return self._request_id

    def _start_request(self, kind: str) -> int:
        req_id = self._new_request_id()
        self._requests[req_id] = {"kind": kind, "event": threading.Event(), "errors": []}
        return req_id

    def _wait_request(self, req_id: int, timeout: float) -> dict[str, Any]:
        request = self._requests[req_id]
        request["event"].wait(timeout)
        self._requests.pop(req_id, None)
        if request["errors"]:
            raise RuntimeError(request["errors"][-1]["message"])
        return request

    def _start_global(self, kind: str) -> None:
        self._global_events[kind].clear()
        if kind == "positions":
            self._positions_buffer = []
        if kind == "open_orders":
            self._open_orders_buffer = {}

    def _finish(self, req_id: int) -> None:
        if req_id in self._requests:
            self._requests[req_id]["event"].set()

    def _finish_global(self, kind: str) -> None:
        self._global_events[kind].set()

    def _next_valid_id(self, order_id: int) -> None:
        self._next_order_id = int(order_id)
        self._next_order_event.set()
        self._connected.set()

    def _connection_closed(self) -> None:
        self._connected.clear()
        self._account_summary_req_id = None
        self._account_summary_event.set()
        self.logger.warning("IBKR TWS connection closed")

    def _error(self, req_id: int, code: int, message: str, advanced_reject: str = "", error_time: Any = None) -> None:
        item = {"req_id": req_id, "code": code, "message": message, "advanced_reject": advanced_reject}
        if error_time is not None:
            item["error_time"] = error_time
        self._last_errors.append(item)
        self._last_error_at = datetime.now(timezone.utc).isoformat()
        if req_id == self._account_summary_req_id:
            self._account_summary_error = item
            self._account_summary_event.set()
        if req_id in self._requests:
            self._requests[req_id]["errors"].append(item)
            self._requests[req_id]["event"].set()
        if code in {1100, 1101, 1102, 1300}:
            self._connected.clear()
        self.logger.error("IBKR error code=%s req_id=%s message=%s", code, req_id, message)

    def _contract_details(self, req_id: int, details: Any) -> None:
        if req_id in self._requests:
            self._requests[req_id].setdefault("details", []).append(contract_details_to_dict(details))

    def _tick_price(self, req_id: int, tick_type: int, value: float) -> None:
        if req_id not in self._requests or value < 0:
            return
        quote = self._requests[req_id].setdefault("quote", {})
        if tick_type in {1, 66}:
            quote["bid"] = float(value)
        elif tick_type in {2, 67}:
            quote["ask"] = float(value)
        elif tick_type in {4, 68}:
            quote["last"] = float(value)
        elif tick_type in {6, 72}:
            quote["high"] = float(value)

    def _tick_size(self, req_id: int, tick_type: int, value: int) -> None:
        if req_id not in self._requests:
            return
        quote = self._requests[req_id].setdefault("quote", {})
        if tick_type in {0, 69}:
            quote["bid_size"] = int(value)
        elif tick_type in {3, 70}:
            quote["ask_size"] = int(value)

    def _account_summary(self, req_id: int, account: str, tag: str, value: str, currency: str) -> None:
        if req_id == self._account_summary_req_id:
            self._account_summary_values[tag] = {"value": value, "currency": currency, "account": account}
        elif req_id in self._requests:
            self._requests[req_id].setdefault("values", {})[tag] = {"value": value, "currency": currency, "account": account}

    def _account_summary_end(self, req_id: int) -> None:
        if req_id == self._account_summary_req_id:
            self._account_summary_event.set()
        else:
            self._finish(req_id)

    def _position(self, account: str, contract: Any, position: float, avg_cost: float) -> None:
        self._positions_buffer.append({
            "account": account,
            "conid": int(getattr(contract, "conId", 0) or 0),
            "symbol": str(getattr(contract, "symbol", "")),
            "sec_type": str(getattr(contract, "secType", "")),
            "exchange": str(getattr(contract, "exchange", "")),
            "currency": str(getattr(contract, "currency", "")),
            "position": float(position),
            "avg_cost": float(avg_cost),
        })

    def _open_order(self, order_id: int, contract: Any, order: Any, order_state: Any) -> None:
        self._open_orders_buffer[int(order_id)] = {
            "broker_order_id": str(order_id),
            "symbol": str(getattr(contract, "symbol", "")),
            "conid": int(getattr(contract, "conId", 0) or 0),
            "action": str(getattr(order, "action", "")),
            "quantity": float(getattr(order, "totalQuantity", 0) or 0),
            "limit_price": float(getattr(order, "lmtPrice", 0) or 0),
            "status": str(getattr(order_state, "status", "")),
        }

    def _order_status(self, order_id: int, status: str, filled: float, remaining: float, avg_fill_price: float, last_fill_price: float) -> None:
        if hasattr(self, "_open_orders_buffer") and int(order_id) in self._open_orders_buffer:
            self._open_orders_buffer[int(order_id)].update({"status": status, "filled": filled, "remaining": remaining, "avg_fill_price": avg_fill_price, "last_fill_price": last_fill_price})
