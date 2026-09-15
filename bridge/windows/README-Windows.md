# IBKR Event Contract Bridge — Windows Guide

This package runs the optional IBKR bridge on a Windows computer at home. The
hosted Site remains the dashboard, database and control plane. The Windows
bridge makes outbound HTTPS requests to the Site and connects only to TWS or IB
Gateway on `127.0.0.1`.

The bridge is paper-only by default. It does not contain an IBKR password,
private key, or saved authentication session.

The package also installs the pinned `yfinance` library for the Deep Research
section. It is read-only: it retrieves stock snapshots, fundamentals, analyst
ratings and one-year history, and cannot place stock orders.

Optional Alpaca support is read-only context collection through Alpaca's
official HTTPS APIs. It never submits Alpaca orders. Leave it disabled unless
you have configured an Alpaca paper account.

## Requirements

- Windows 10 or Windows 11
- Python 3.11 or newer
- IB Gateway or Trader Workstation installed from Interactive Brokers
- A funded and opened IBKR Pro account
- A normal, authorised IBKR login and 2FA
- The private Site URL
- A long random bridge token stored both in the Site secret and this machine's `.env`

IBKR's TWS API connects to TWS or IB Gateway through a local API connection.
Do not expose the API port to the internet and do not configure port
forwarding. The installer uses the official downloaded TWS API source rather
than installing `ibapi` from PyPI.

## 1. Extract and install

Extract this package to a folder such as `C:\IBKRBridgeSource`. Open
PowerShell in the extracted `bridge` folder and run:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
.\windows\install.ps1 -InstallRoot C:\IBKRBridge
```

The installer creates a virtual environment, installs the pinned supporting dependencies,
creates `C:\IBKRBridge\.env` if absent, creates data/log folders, and runs a
paper-mode health check.

## 2. Install the official TWS API Python client

1. Download the current Windows TWS API from [IBKR's official API download](https://interactivebrokers.github.io/).
2. Run the MSI and accept the licence. The normal installation path is
   `C:\\TWS API`.
3. Confirm that `C:\\TWS API\\source\\pythonclient\\setup.py` exists.
4. If you used another path, set `IBKR_TWS_API_PYTHON_PATH` in the bridge
   `.env` before running the installer.

The installer verifies this path and installs the official `ibapi` package into
the bridge virtual environment.

## 3. Configure the Site and bridge token

Create one long random token using a password manager. Set it as the Site's
secret named `IBKR_BRIDGE_TOKEN`. Set the same value as `BRIDGE_TOKEN` in
`C:\IBKRBridge\.env`.

Set these values in `C:\IBKRBridge\.env`:

```env
BRIDGE_ID=my-home-windows-bridge
SITE_BASE_URL=https://ibkr-event-contract-workbench.emeraldpathways.chatgpt.site
BRIDGE_TOKEN=the-same-token-as-the-site-secret
TRADING_MODE=paper
LIVE_TRADING_ENABLED=false
IBKR_CONNECTION_MODE=tws_api
IBKR_HOST=127.0.0.1
IBKR_TWS_API_PYTHON_PATH=C:\\TWS API\\source\\pythonclient
IBKR_PORT=4002
IBKR_ACCOUNT_ID=your-account-id
DATA_DIR=C:\IBKRBridge\data
LOG_DIR=C:\IBKRBridge\logs
```

Never put an IBKR password in the Site, the browser, or this file.

Optional Alpaca context (paper/read-only):

```env
ALPACA_ENABLED=true
ALPACA_API_KEY=your-paper-api-key
ALPACA_API_SECRET=your-paper-api-secret
ALPACA_TRADING_BASE_URL=https://paper-api.alpaca.markets
ALPACA_DATA_BASE_URL=https://data.alpaca.markets
ALPACA_DATA_FEED=iex
ALPACA_SYMBOLS=SPY,QQQ,TLT,GLD
ALPACA_CRYPTO_SYMBOLS=
ALPACA_NEWS_SYMBOLS=SPY,QQQ
ALPACA_LIVE_TRADING_ENABLED=false
```

Set `ALPACA_ENABLED=true` in the private Site's managed environment too. The
Alpaca keys remain only in the Windows bridge `.env`.

## 4. Configure TWS or IB Gateway

1. Start TWS or IB Gateway.
2. Log in manually with your normal IBKR account and complete 2FA.
3. Open **Global Configuration → API → Settings**.
4. Enable **ActiveX and Socket Clients**.
5. Disable **Read-Only API** when deliberately testing approved order submission.
6. Enable **Allow connections from localhost only** where available.
7. Set the API port to the same value as `IBKR_PORT`.
8. Keep TWS or IB Gateway running.

Normal default ports are:

| IBKR application | Paper | Live |
| --- | ---: | ---: |
| TWS | 7497 | 7496 |
| IB Gateway | 4002 | 4001 |

The bridge does not use browser automation and does not log in to IBKR itself.

## 5. Run and verify the bridge

From `C:\IBKRBridge`:

```powershell
.\windows\run-health-check.ps1
.\windows\run-bridge.ps1
```

Then open the Site and confirm:

- Bridge connected
- Recent bridge heartbeat
- Contract permission status
- Fresh quotes
- Account balance, if available
- No risk breach

The bridge currently accepts explicit contract specifications through
`IBKR_EVENT_CONTRACT_SPECS_JSON`. Use identifiers copied from your own eligible
IBKR/TWS catalog. Do not invent conids or contract fields.

## 6. Start automatically at Windows logon

After manually testing the bridge:

```powershell
.\windows\register-task.ps1 -InstallRoot C:\IBKRBridge
```

This creates a limited-permission Task Scheduler task for the current Windows
user. It starts the bridge at logon and restarts it a limited number of times
after failure. TWS or IB Gateway must still be running and authenticated.

To remove the task:

```powershell
.\windows\unregister-task.ps1
```

Prevent the computer from sleeping while the bridge is expected to operate.
Windows updates, reboots, network loss, TWS disconnects and manual logout will
make the bridge stale; the Site will fail closed and disable live execution.

## 7. Paper-to-live procedure

Do not enable live mode during the first installation. First confirm a complete
paper workflow in the Site:

1. Research an event.
2. Generate a proposal.
3. Approve it manually.
4. Check the simulated fill and portfolio.
5. Test resolution and risk limits.
6. Confirm the bridge heartbeat and reconciliation.

Only then, if you independently decide to use live trading, configure the
Site and bridge gates together:

```env
TRADING_MODE=live
LIVE_TRADING_ENABLED=true
MANUAL_APPROVAL_REQUIRED=true
ALLOW_MARKET_ORDERS=false
```

The Site and bridge perform separate risk checks. Live execution remains
disabled if permissions, quotes, account funds, approval, expiry, risk limits,
or the kill switch are not valid.

## Logs and troubleshooting

Bridge logs are written to the configured `LOG_DIR`, normally:

```text
C:\IBKRBridge\logs\trading.log
```

Common checks:

```powershell
Get-Content C:\IBKRBridge\logs\trading.log -Wait
Get-NetTCPConnection -LocalPort 4002 -State Listen
Get-ScheduledTask -TaskName "IBKR Event Contract Bridge"
```

If the bridge reports HTTP 401 or 403, revoke and replace the bridge token in
both locations, then restart the bridge. Do not blindly retry an order after a
network failure; check the Site's order and audit records first.

## Safety boundaries

- Live trading is disabled by default.
- The Site never receives or displays an IBKR password.
- The browser cannot submit an IBKR order directly.
- The bridge uses outbound HTTPS to the Site.
- The IBKR API connection is localhost-only.
- No VPN, proxy, location spoofing, or geographic-circumvention feature is
  included.
- IBKR event-contract availability and permissions must be confirmed in your
  own account.
