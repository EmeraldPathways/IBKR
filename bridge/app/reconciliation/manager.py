from __future__ import annotations

from typing import Any


def make_reconciliation_event(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": "reconciliation",
        "snapshot": {
            "mode": snapshot.get("mode", "paper"),
            "account": snapshot.get("account", {}),
            "positions": snapshot.get("positions", []),
            "open_orders": snapshot.get("open_orders", []),
            "observed_at": snapshot.get("observed_at"),
        },
    }
