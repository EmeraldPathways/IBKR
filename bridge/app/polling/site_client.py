from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any

try:
    import httpx
except ImportError:  # The setup script installs httpx for bridge runtime use.
    httpx = None  # type: ignore[assignment]

from ..config import Config


class BridgeSecurityError(RuntimeError):
    pass


class SiteClient:
    def __init__(self, config: Config, logger: Any) -> None:
        if not config.site_base_url:
            raise ValueError("SITE_BASE_URL is required for the bridge.")
        if not config.bridge_token:
            raise ValueError("BRIDGE_TOKEN is required for the bridge.")
        if httpx is None:
            raise RuntimeError("Install the pinned bridge dependencies before starting the bridge.")
        self.config = config
        self.logger = logger
        self.http = httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0), follow_redirects=False)

    def close(self) -> None:
        self.http.close()

    def poll_commands(self, limit: int = 10) -> list[dict[str, Any]]:
        payload = self._request("GET", f"/api/bridge/commands?bridgeId={self.config.bridge_id}&limit={min(max(limit, 1), 25)}", retry_safe=True)
        return list(payload.get("commands", []))

    def heartbeat(self, status: str, permissions: dict[str, Any], account_id: str | None, version: str) -> dict[str, Any]:
        return self._request("POST", "/api/bridge/heartbeat", {
            "status": status,
            "permissions": permissions,
            "account_id": account_id,
            "version": version,
        }, retry_safe=True)

    def events(self, events: list[dict[str, Any]]) -> dict[str, Any]:
        return self._request("POST", "/api/bridge/events", {"events": events[:100]}, retry_safe=True)

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None, retry_safe: bool = False) -> dict[str, Any]:
        url = f"{self.config.site_base_url}{path}"
        serialized = "" if body is None else json.dumps(body, separators=(",", ":"), ensure_ascii=False)
        timestamp = str(int(time.time()))
        signature = canonical_signature(self.config.bridge_token, timestamp, method, path.split('?', 1)[0], serialized)
        headers = {
            "Authorization": f"Bearer {self.config.bridge_token}",
            "X-Bridge-ID": self.config.bridge_id,
            "X-Bridge-Timestamp": timestamp,
            "X-Bridge-Signature": signature,
            "Accept": "application/json",
        }
        if body is not None:
            headers["Content-Type"] = "application/json"

        response = self.http.request(method, url, content=serialized or None, headers=headers)
        if response.status_code in {401, 403}:
            raise BridgeSecurityError(f"Site rejected bridge authentication with HTTP {response.status_code}.")
        if response.status_code == 429:
            retry_after = _retry_after(response.headers.get("Retry-After"))
            if not retry_safe:
                raise RuntimeError("Site rate-limited a non-idempotent bridge operation; it was not retried.")
            time.sleep(min(retry_after + 2.0, 60.0))
            return self._request(method, path, body, retry_safe=False)
        if response.status_code >= 500 and retry_safe:
            time.sleep(2.0)
            response = self.http.request(method, url, content=serialized or None, headers=headers)
        if response.status_code >= 400:
            raise RuntimeError(f"Site request failed with HTTP {response.status_code}: {response.text[:300]}")
        try:
            return response.json()
        except ValueError as exc:
            raise RuntimeError("Site returned a non-JSON bridge response.") from exc


def _retry_after(value: str | None) -> float:
    try:
        return max(0.0, min(float(value or 5), 60.0))
    except ValueError:
        return 5.0


def canonical_signature(secret: str, timestamp: str, method: str, path: str, body: str) -> str:
    message = f"{timestamp}.{method.upper()}.{path}.{body}"
    return hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
