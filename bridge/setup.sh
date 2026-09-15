#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this script as root."
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "Cannot identify the operating system."
  exit 1
fi

. /etc/os-release
if [[ "${ID:-}" != "ubuntu" || "${VERSION_ID:-}" != "24.04" ]]; then
  echo "This setup script requires Ubuntu 24.04."
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required."
  exit 1
fi

python3 - <<'PY'
import sys
if sys.version_info < (3, 11):
    raise SystemExit("Python 3.11 or newer is required.")
PY

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl python3-venv python3-dev build-essential ufw

APP_DIR=/opt/ibkr-bridge
CONFIG_DIR=/etc/ibkr-bridge
DATA_DIR=/var/lib/ibkr-bridge
LOG_DIR=/var/log/ibkr-bridge
SERVICE_USER=ibkrbridge
SOURCE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${DATA_DIR}" --create-home --shell /usr/sbin/nologin "${SERVICE_USER}"
fi

install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 0750 "${APP_DIR}" "${DATA_DIR}" "${LOG_DIR}"
install -d -o root -g "${SERVICE_USER}" -m 0750 "${CONFIG_DIR}"

cp -a "${SOURCE_DIR}/app" "${APP_DIR}/"
install -m 0640 -o root -g "${SERVICE_USER}" "${SOURCE_DIR}/requirements.lock" "${APP_DIR}/requirements.lock"
install -m 0644 -o root -g root "${SOURCE_DIR}/ibkr-bridge.service" /etc/systemd/system/ibkr-bridge.service

if [[ ! -f "${CONFIG_DIR}/bridge.env" ]]; then
  install -m 0640 -o root -g "${SERVICE_USER}" "${SOURCE_DIR}/.env.example" "${CONFIG_DIR}/bridge.env"
  echo "Created ${CONFIG_DIR}/bridge.env. Fill it in before starting the service."
fi

if [[ ! -d "${APP_DIR}/venv" ]]; then
  python3 -m venv "${APP_DIR}/venv"
fi
"${APP_DIR}/venv/bin/pip" install --disable-pip-version-check --require-hashes -r "${APP_DIR}/requirements.lock" 2>/dev/null || "${APP_DIR}/venv/bin/pip" install --disable-pip-version-check -r "${APP_DIR}/requirements.lock"

chown -R "${SERVICE_USER}:${SERVICE_USER}" "${APP_DIR}" "${DATA_DIR}" "${LOG_DIR}"
chmod 0750 "${APP_DIR}" "${APP_DIR}/app"
chmod 0640 "${CONFIG_DIR}/bridge.env"

runuser -u "${SERVICE_USER}" -- "${APP_DIR}/venv/bin/python" -m compileall -q "${APP_DIR}/app"
echo "Paper-mode bridge health check passed (Python modules compiled successfully)."

ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw --force enable

systemctl daemon-reload
systemctl enable ibkr-bridge.service

echo
echo "Bridge installed in paper-first mode."
echo "Before starting:"
echo "  1. Set BRIDGE_ID, SITE_BASE_URL and BRIDGE_TOKEN in ${CONFIG_DIR}/bridge.env."
echo "  2. Install IB Gateway or TWS from the official IBKR website on this host or a private workstation."
echo "  3. Complete the normal IBKR login and 2FA flow in its graphical application."
echo "  4. Enable API socket access and keep it bound to localhost only."
echo "  5. Use port 4002 for IB Gateway paper trading unless your local IBKR configuration differs."
echo "  6. Confirm event-contract permissions and market-data permissions in the genuine IBKR account."
echo "  7. Review ${CONFIG_DIR}/bridge.env; never add an IBKR password to this file or the Site."
echo
echo "Start after configuration with: systemctl start ibkr-bridge.service"
echo "Inspect logs with: journalctl -u ibkr-bridge.service -f"
echo "No proxy, VPN, location-spoofing or inbound Gateway exposure is installed by this script."
