import { riskChecks } from "@/lib/trading-logic.mjs";
import { getD1, getOrderRows, getPortfolioSummary, getSettings, id, jsonError, nowIso, requireViewer } from "@/lib/server";
import { getStockSnapshot } from "@/lib/stock-research";

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    const body = (await request.json().catch(() => null)) as { ticker?: string; quantity?: number } | null;
    const ticker = String(body?.ticker ?? "").trim().toUpperCase().replace(/[^A-Z0-9.^=-]/g, "");
    const quantity = Number(body?.quantity ?? 1);
    if (!ticker || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1000) {
      return Response.json({ error: "Enter a valid ticker and positive share quantity." }, { status: 400 });
    }
    const settings = await getSettings();
    if (settings.mode !== "paper") throw new Error("Stock proposals are currently available only in paper mode.");
    const snapshot = await getStockSnapshot(ticker);
    if (snapshot.price == null || !Number.isFinite(snapshot.price) || snapshot.price <= 0) throw new Error("A current stock price is unavailable.");
    const db = await getD1();
    if (!db) throw new Error("The durable paper-trading database is unavailable.");
    const now = nowIso();
    const contractId = `stock:${ticker}`;
    const question = `Buy ${ticker} shares at or below the current paper quote`;
    const existingContract = await db.prepare("SELECT id FROM contracts WHERE id = ?").bind(contractId).first();
    const contractStatement = existingContract
      ? db.prepare("UPDATE contracts SET question = ?, symbol = ?, provider = ?, exchange = ?, currency = ?, ask = ?, last_price = ?, status = 'paper_only', eligible = 1, data_origin = 'yahoo_finance', updated_at = ? WHERE id = ?").bind(question, ticker, "Yahoo Finance", "SMART", snapshot.currency || "USD", snapshot.price, snapshot.price, now, contractId)
      : db.prepare("INSERT INTO contracts (id, market_group, ibkr_conid, provider, exchange, symbol, sec_type, trading_class, question, outcome, settlement_value, expiration, resolution_criteria, currency, tick_size, minimum_quantity, ask, last_price, status, permission_status, eligible, data_origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(contractId, contractId, null, "Yahoo Finance", "SMART", ticker, "STK", ticker, question, "LONG", 0, new Date(Date.now() + 3650 * 86400000).toISOString(), "Paper equity position marked against the latest research quote.", snapshot.currency || "USD", 0.01, 1, snapshot.price, snapshot.price, "paper_only", "paper", 1, "yahoo_finance", now, now);
    const portfolio = await getPortfolioSummary();
    const orders = await getOrderRows();
    const currentExposure = Number((portfolio.positions as Array<Record<string, unknown>>).find((row) => row.contract_id === contractId)?.cost_basis ?? 0);
    const checks = riskChecks({ quantity, price: snapshot.price, currentExposure, totalExposure: Number(portfolio.costBasis ?? 0), dailyPnl: Number(portfolio.dailyPnl ?? 0), startingCapital: settings.startingCapitalUsd, openOrders: orders.filter((row) => ["pending", "submitted", "partially_filled"].includes(String(row.status))).length, config: settings, killSwitch: settings.killSwitch });
    if (!checks.pass) throw new Error("The proposed paper order exceeds one or more configured risk limits.");
    const quoteId = id("quote");
    const proposalId = id("proposal");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const notional = Number((quantity * snapshot.price).toFixed(8));
    await db.batch([
      contractStatement,
      db.prepare("INSERT INTO quotes (id, contract_id, ask, last_price, is_fresh, observed_at) VALUES (?, ?, ?, ?, 1, ?)").bind(quoteId, contractId, snapshot.price, snapshot.price, now),
      db.prepare("INSERT INTO trade_proposals (id, contract_id, outcome, direction, current_quote, estimated_probability, gross_edge, net_edge, max_entry_price, quantity, notional_value, confidence, evidence_json, risk_check_results_json, status, expires_at, mode, created_at, updated_at) VALUES (?, ?, 'LONG', 'BUY', ?, 0.5, 0, 0, ?, ?, ?, 0.5, ?, ?, 'pending', ?, 'paper', ?, ?)").bind(proposalId, contractId, snapshot.price, snapshot.price, quantity, notional, JSON.stringify([{ title: `Market snapshot for ${ticker}`, url: "https://finance.yahoo.com/", publishedAt: now, source: "Yahoo Finance" }]), JSON.stringify(checks.checks), expiresAt, now, now),
      db.prepare("INSERT INTO audit_log (id, actor, action, entity_type, entity_id, payload_json, created_at) VALUES (?, ?, 'stock_proposal_created', 'trade_proposal', ?, ?, ?)").bind(id("audit"), viewer.id, proposalId, JSON.stringify({ ticker, quantity, price: snapshot.price, mode: "paper" }), now),
    ]);
    return Response.json({ proposalId, ticker, quantity, price: snapshot.price, notional, status: "pending", mode: "paper" });
  } catch (error) {
    return jsonError(error);
  }
}
