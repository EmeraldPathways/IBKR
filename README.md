# IBKR Event Contract Workbench

Private, paper-first research and trading control plane for Interactive Brokers event contracts. The application is designed for one Ireland-based owner and does not include geographic-circumvention features.

## What this project does

The Site provides:

- contract discovery and permission-aware market states;
- YES/NO quote comparison and implied probabilities;
- evidence-bound research runs with clearly labelled estimates;
- manually approved trade proposals;
- a durable D1-backed paper portfolio, fills, P&L and resolution simulation;
- risk limits, audit events and a global kill switch;
- an optional outbound-only bridge for approved IBKR execution.
- an in-app Luna helper for dashboard guidance, research interpretation and risk explanations.
- a Deep Research workspace for yfinance-powered equity snapshots, one-year charts, structured AI briefs and peer comparisons.

The first-time experience is immediately usable in paper mode. It starts with illustrative rows labelled `Paper only`; those rows are not live IBKR quotes and cannot be routed to a broker.

## Architecture

```text
Private Codex Site
├── React/Vinext dashboard
├── Cloudflare Worker HTTP API
├── D1 durable state and queue
├── Research and probability handlers
├── Paper broker adapter
└── Bridge command queue

Optional user-controlled bridge
├── Python process on the user’s Windows home computer
├── Official IBKR TWS API connection to local TWS/IB Gateway
├── Outbound HTTPS polling to the Site
└── Local risk checks, idempotency and reconciliation
```

### Optional Alpaca context connector

The Windows bridge can optionally collect Alpaca paper-account status,
positions, open orders, stock/crypto snapshots and recent news through the
official HTTPS APIs. It sends only redacted snapshots to the Site over the
existing signed channel. This connector is read-only for Alpaca: it never
submits Alpaca orders and cannot enable Alpaca live trading. Set
`ALPACA_ENABLED=true` in Site-managed environment values and configure the
bridge separately. If it is unavailable, IBKR and paper trading continue
normally.

The hosted Site never opens a raw TCP socket. The local TWS socket is confined to the bridge process. The bridge does not listen for inbound public traffic.

This project is designed for a private Codex Site plus one Windows computer at
home. Cloudways, Ubuntu, a VPS and a separate public server are not required.

## Paper mode

Paper mode works without an IBKR account:

1. Open Event markets and choose a market.
2. Run research.
3. Review the market-implied probability, deterministic or structured estimate, edge, evidence and uncertainty.
4. Approve a pending proposal explicitly.
5. The Site creates a simulated limit order, fill, position and portfolio snapshot in D1.
6. Use the portfolio controls to export history, reset the simulation, replay a proposal or simulate YES/NO resolution.

Paper values are simulated. They are not evidence of expected returns or execution quality.

## Live mode and the optional bridge

Live execution is disabled by default in both the Site and the bridge. A live order is only eligible when all of these checks pass:

- Site live mode and server safety gate are enabled;
- bridge live mode is enabled;
- the bridge is connected to the genuine IBKR account;
- the contract is accessible and the current quote is fresh;
- account funds and local risk checks pass;
- the user has explicitly approved the proposal;
- the price is within the proposal ceiling;
- the kill switch is inactive;
- the order is an allowed whole-quantity limit order.

The bridge fails closed on authentication failures, permission errors, stale quotes, insufficient funds, broker disconnects and order rejections. It also keeps a local idempotency record so a leased command is not blindly submitted twice after a restart.

### IBKR event-contract limitations reflected here

The current IBKR event-contract documentation models ForecastEx instruments as `OPT` contracts routed to `FORECASTX`; YES maps to Call and NO maps to Put. ForecastEx positions cannot be sold; buying the opposing contract is the documented way to reduce or flatten. IBKR documents event contracts as limit-only with `DAY`, `GTC` or `IOC` time in force, and whole-share quantities.

The current TWS API guide also says event-contract market scanners are not available for research, so the bridge accepts explicit contract specifications and contract-detail requests rather than pretending there is an undocumented scanner. Confirm product availability, account permission, market-data access and contract rules in the user’s own IBKR account before using live mode.

Official references:

- [Event Contracts in the Web API](https://www.interactivebrokers.com/campus/ibkr-api-page/event-contracts/)
- [TWS API Event Trading](https://www.interactivebrokers.com/campus/ibkr-api-page/event-trading/)
- [TWS API introduction](https://www.interactivebrokers.com/docs/tws-api/doc/introduction)
- [Trading Web API](https://ibkrcampus.com/campus/ibkr-api-page/web-api-trading/)

### Ireland and account eligibility

Use the genuine IBKR Ireland account, declared residence and normal authorised connection. Do not use VPNs, proxies, location spoofing, rotating IPs, KYC circumvention or account-location misrepresentation. Event-contract availability and permissions are account-specific and must be confirmed directly with IBKR. Irish tax and regulatory treatment should be checked with a qualified professional.

## Deploy the private Site

The repository is a Vinext/Cloudflare Worker Site. `.openai/hosting.json` declares the logical D1 binding as `DB`; Sites owns the actual D1 resource and applies the generated migration under `drizzle/` during deployment.

1. Keep the Site private/owner-only.
2. Add runtime values through Site-managed environment variables. Do not commit `.env` files.
3. Set `TRADING_MODE=paper`, `LIVE_TRADING_ENABLED=false`, `MANUAL_APPROVAL_REQUIRED=true` and `ALLOW_MARKET_ORDERS=false` initially.
4. Add `OPENAI_API_KEY` if using structured analysis or Ask Luna. It is server-only and never sent to the browser.
5. Deploy the Site and verify `/api/health` after the D1 migration has been applied.

The database schema covers contracts, quotes, research, probability estimates, proposals, orders, fills, positions, portfolio snapshots, risk events, durable jobs, bridge heartbeats, audit logs, app settings, source health, ingestion runs, market snapshots, resolution observations, forecast snapshots, data-quality events and auditable agent runs.

Research feeds are an explicit HTTPS RSS/Atom allowlist configured through `NEWS_RSS_URLS` or Settings. The Site uses ETags/Last-Modified, bounded timeouts, feed-size limits, hashes and D1 deduplication; it does not aggressively scrape arbitrary pages. The deterministic engine and optional structured analysis treat feed items as evidence, not facts, and reject malformed or stale evidence.

The default source registry includes the ECB, Ireland's CSO, the IBKR bridge and configured RSS/Atom feeds. These are source definitions only: connect the Windows bridge and configure approved feeds before treating any result as current or decision-grade. Seeded demo markets remain paper-only.

Research can be run through two persistent agent roles. The Worker (`WORKER_MODEL`, default `5.6 Luna Medium`) performs read-only collection and normalization. The Manager (`MANAGER_MODEL`, default `5.6 Luna Max`) reviews evidence, uncertainty, costs and risk before a proposal can be created. Neither agent can submit an order; manual approval and both Site and bridge safety gates remain mandatory.

The **Ask Luna** tab is a separate advisory helper using the server-side `OPENAI_API_KEY`. It understands the workbench and can explain markets, proposals, paper positions, risk checks and bridge status. It cannot approve, cancel or submit orders. Conversation history is stored per signed-in owner in D1 after basic secret redaction. The helper reads `OPENAI_MODEL` and `OPENAI_BASE_URL` as well as the optional `OPENAI_HELPER_MODEL`; with the variables shown in the supplied Site settings, it will call the configured OpenAI-compatible Responses endpoint. Never paste passwords, API keys, tokens or private account data into the helper.

### Deep Research

Deep Research is a separate stock-analysis section. The Windows bridge includes the pinned `yfinance` library and can collect ticker fundamentals, analyst ratings and one-year daily history through `deep_research_stock` and `deep_research_competitors` commands. The hosted Site also has a labelled HTTP market-data fallback because Cloudflare Workers cannot import or execute Python libraries. The AI brief uses the existing Site-managed `OPENAI_API_KEY`, `OPENAI_BASE_URL` and `OPENAI_MODEL` values through the server-side Responses API. The model output is analysis, not fact or advice, and it cannot submit trades.

Professional controls now include market-quality scoring, resolution-readiness gating, market and forecast snapshots, calibration metrics (Brier score, log loss and accuracy), and resolution-linked forecast scoring after a paper position is simulated as resolved. A contract with unclear or unverified resolution information can still be researched, but it cannot create a new trade proposal.

The decision layer also includes an opportunity rank, capped quarter-Kelly paper
sizing, walk-forward Brier analytics, scenario analysis and auditable evidence
snapshots. These tools are decision aids, not return guarantees. Execution
quality, slippage and fill-rate measurements should be treated as incomplete
until the bridge has collected enough real observations.

## Runtime environment

Copy `.env.example` for local reference only. Hosted secrets belong in Sites runtime settings. Never put IBKR passwords, private keys, API secrets or unredacted access tokens in D1, frontend JavaScript or Git.

The Site accepts `IBKR_BRIDGE_TOKEN` as a server secret. The bridge uses the same value as `BRIDGE_TOKEN` and signs every request with an HMAC-SHA256 signature containing the timestamp, HTTP method, path and body. The Site rejects stale timestamps, missing bearer tokens and invalid signatures.

## Configure the bridge

The bridge lives in `bridge/` and is optional. It supports the official IBKR TWS API path. IBKR's current requirements specify a funded and opened IBKR Pro account, current TWS or IB Gateway, current TWS API and Python 3.11+. The Windows installer therefore requires the official downloaded TWS API Python source and runs its `source/pythonclient/setup.py`; it does not install `ibapi` from PyPI. See [IBKR requirements](https://www.interactivebrokers.com/docs/tws-api/doc/notes-limitations/requirements) and [IBKR API download guidance](https://www.interactivebrokers.com/docs/tws-api/doc/download-the-tws-api/introduction).

On Windows 10/11, use the files in `bridge/windows/` or the downloadable
`IBKRBridge-Windows` package:

1. Extract the package and run `windows\\install.ps1` from PowerShell.
2. Fill `C:\\IBKRBridge\\.env` with the private Site URL, bridge ID, bridge token and IBKR account ID.
3. Install the current TWS API and TWS or IB Gateway from IBKR’s official distribution.
4. Complete the normal graphical login and 2FA flow.
5. In **Global Configuration → API → Settings**, enable **ActiveX and Socket Clients**, verify the socket port, and keep access restricted to localhost. Disable **Read-Only API** only when deliberately testing approved order submission. See [IBKR TWS settings](https://www.interactivebrokers.com/docs/tws-api/doc/tws-settings/introduction).
6. Run `windows\\run-health-check.ps1`, then `windows\\run-bridge.ps1` in paper mode first.
7. Optionally register the bridge with Windows Task Scheduler after manual testing.
8. Confirm the dashboard heartbeat and permission state before any live configuration.

Because the current TWS event-trading documentation does not expose an event-contract market scanner, catalog sync uses explicit specifications from the user’s own IBKR catalog. Put a JSON array in `IBKR_EVENT_CONTRACT_SPECS_JSON`, for example:

```json
[
  {
    "market_group": "my-event",
    "question": "Contract question from the IBKR catalog",
    "provider": "ForecastEx",
    "symbol": "SYMBOL_FROM_IBKR",
    "sec_type": "OPT",
    "exchange": "FORECASTX",
    "currency": "USD",
    "expiry": "20261208",
    "strike": 5,
    "outcome": "YES",
    "resolution_criteria": "Exact rules copied from the contract"
  }
]
```

Use the dashboard’s “Sync bridge catalog” action after saving the bridge environment. The bridge resolves contract details and quotes through TWS, then reports only normalized, redacted data to the Site. If the account cannot resolve a specification, the Site keeps it out of the eligible live catalog.

The bridge currently implements the official TWS API route. IBKR Web API availability and onboarding vary by account and product; if that route is enabled for the account, it should be implemented as a separate `IBKRAdapter` while preserving the same outbound Site protocol and gates. No undocumented Web API endpoint is assumed here.

For optional Alpaca context, copy the Alpaca values from
`bridge/windows/.env.windows.example` into the bridge `.env`. Use the paper
Trading API base URL. Alpaca keys stay on Windows and are never shown in the
browser or stored in D1. Confirm account eligibility and market-data feed
access with Alpaca; the Site does not infer either.

The Windows installer creates a local virtual environment, data/log folders and
the bridge `.env` file only when absent. It does not install proxy, VPN or
location-spoofing software.

Useful PowerShell commands:

```powershell
cd C:\\IBKRBridge
.\\windows\\run-health-check.ps1
.\\windows\\run-bridge.ps1
Get-Content C:\\IBKRBridge\\logs\\trading.log -Wait
```

The bridge handles SIGINT/SIGTERM, attempts emergency cancellation of active broker orders when live mode is genuinely enabled, disconnects cleanly, and continues to fail closed when IBKR or the Site is unavailable.

If the bridge receives HTTP 401/403, it disables live operation and requires manual intervention. A 429 honors `Retry-After` plus a bounded delay; non-idempotent order submissions are never blindly retried. After a restart, the bridge reloads its local idempotency file, reconnects when available, polls leased commands and performs reconciliation jobs. Paper reset only removes paper orders, fills, positions and snapshots.

To revoke a bridge token, disable Site live execution, generate a replacement Site secret, update `BRIDGE_TOKEN` in `C:\\IBKRBridge\\.env`, restart the bridge and confirm the old bridge is rejected. Do not put the token in frontend code or D1 data rows.

## Durable queue

Hosted jobs are stored in D1, not in an in-memory queue. Jobs carry an idempotency key, attempt count, lease expiry, error message and one of:

```text
pending → claimed → processing → completed
                           ↘ failed / expired / cancelled
```

Bridge command claiming uses a single conditional D1 update with leases. The bridge polls explicitly; the Site is not described or implemented as a permanent daemon.

## Testing

The project includes build-time UI checks, pure trading-logic tests and Python bridge tests. Tests do not require live IBKR credentials.

```bash
npm test
python3 -m unittest discover -s bridge/tests -p 'test_*.py'
```

The Python tests exercise quote freshness, limit-order validation, ForecastEx sell protection, HMAC signing, retry handling, idempotency and secret redaction.

## Operational risk

Event contracts can lose the premium paid and can have low liquidity, stale or unavailable data, non-obvious resolution rules, execution risk, fees, slippage and account-specific restrictions. The research engine is not a financial adviser. Test in paper mode, read the exact contract rules and obtain professional Irish tax/regulatory advice before using live execution.
