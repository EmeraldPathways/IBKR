import { headers } from "next/headers";
import {
  calculateEdge,
  demoProbabilityForMarket,
  estimateCosts,
  freshQuote,
  riskChecks,
  roundToTick,
  scoreMarketQuality,
  scoringMetrics,
  fractionalKelly,
  rankOpportunity,
  walkForwardBrier,
  calibrationDiagnostics,
  stressTestPortfolio,
  edgeDecay,
  resolutionIntegrity,
  purgedWalkForwardBrier,
  abstentionDiagnostics,
  forecastEdgeMap,
  simulateLimitFill,
  correlationWarnings,
} from "./trading-logic.mjs";
import { collectResearchEvidence, isFreshEvidence } from "./research-engine";
import { IBKRBridgeAdapter, PaperBrokerAdapter, type BrokerAdapter } from "./broker-adapters";

type RuntimeBindings = {
  DB?: D1Database;
  [key: string]: unknown;
};

export type Viewer = {
  id: string;
  email: string;
  displayName: string;
};

export type Settings = {
  mode: "paper" | "live";
  paperExecutionTarget: "ibkr" | "site";
  manualApprovalRequired: boolean;
  allowMarketOrders: boolean;
  liveTradingEnabled: boolean;
  bridgeConfigured: boolean;
  watchlist: string[];
  minEdge: number;
  minConfidence: number;
  maxPositionPerContractUsd: number;
  maxTotalExposureUsd: number;
  maxOrderSizeUsd: number;
  maxDailyLossUsd: number;
  startingCapitalUsd: number;
  minAccountFloorPercent: number;
  maxConcurrentOrders: number;
  maxSlippagePercent: number;
  orderTimeoutSeconds: number;
  researchRefreshMinutes: number;
  newsRssUrls: string;
  llmProvider: "deterministic" | "openai";
  llmModel: string;
  killSwitch: boolean;
  paperCash: number;
};

type Row = Record<string, unknown>;

const DEFAULT_SETTINGS: Omit<Settings, "liveTradingEnabled" | "bridgeConfigured" | "paperCash"> = {
  mode: "paper",
  paperExecutionTarget: "ibkr",
  manualApprovalRequired: true,
  allowMarketOrders: false,
  watchlist: [],
  minEdge: 0.05,
  minConfidence: 0.6,
  maxPositionPerContractUsd: 50,
  maxTotalExposureUsd: 250,
  maxOrderSizeUsd: 20,
  maxDailyLossUsd: 30,
  startingCapitalUsd: 1000,
  minAccountFloorPercent: 20,
  maxConcurrentOrders: 3,
  maxSlippagePercent: 0.015,
  orderTimeoutSeconds: 60,
  researchRefreshMinutes: 15,
  newsRssUrls: "",
  llmProvider: "deterministic",
  llmModel: "gpt-5-mini",
  killSwitch: false,
};

const DURABLE_JOB_TYPES = new Set([
  "research",
  "news_refresh",
  "probability_analysis",
  "trade_proposal",
  "bridge_command",
  "reconciliation",
]);

let runtimeEnvPromise: Promise<RuntimeBindings> | null = null;

async function runtimeBindings(): Promise<RuntimeBindings> {
  if (!runtimeEnvPromise) {
    runtimeEnvPromise = import("cloudflare:workers")
      .then((module) => module.env as unknown as RuntimeBindings)
      .catch(() => {
        if (typeof process === "undefined") return {};
        return process.env as RuntimeBindings;
      });
  }
  return runtimeEnvPromise;
}

export async function getD1(): Promise<D1Database | null> {
  return (await runtimeBindings()).DB ?? null;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function id(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}_${uuid ?? Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

function localDevelopment(): boolean {
  return typeof process !== "undefined" && process.env.NODE_ENV !== "production";
}

export async function getViewer(): Promise<Viewer | null> {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? safeDecode(encodedName)
      : null;

  if (userId || email) {
    return {
      id: userId ?? email ?? "workspace-user",
      email: email ?? "workspace-user",
      displayName: fullName ?? email ?? "Workspace user",
    };
  }

  if (localDevelopment()) {
    return { id: "local-dev", email: "local@development", displayName: "Local paper workspace" };
  }

  // The Site is intentionally public for paper-mode research and AI features.
  // This identity is only enabled by an explicit runtime setting; bridge
  // requests still require their separate bearer-token authentication.
  const env = await runtimeBindings();
  if (String(env.PUBLIC_PAPER_MODE ?? "").toLowerCase() === "true") {
    return { id: "public-paper", email: "paper@public.workspace", displayName: "Public paper workspace" };
  }

  return null;
}

export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) throw new ApiError("Authentication required", 401);
  return viewer;
}

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "bad_request") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function jsonError(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Unexpected server error";
  return Response.json({ error: message }, { status: 500 });
}

async function requireDb(): Promise<D1Database> {
  const db = await getD1();
  if (!db) {
    throw new ApiError(
      "The durable D1 database is not connected yet. Deploy with the DB binding declared in .openai/hosting.json.",
      503,
      "database_unavailable",
    );
  }
  return db;
}

async function all<T extends Row>(db: D1Database, query: string, ...params: unknown[]): Promise<T[]> {
  const statement = db.prepare(query);
  const result = params.length ? await statement.bind(...params).all<T>() : await statement.all<T>();
  return result.results ?? [];
}

async function first<T extends Row>(db: D1Database, query: string, ...params: unknown[]): Promise<T | null> {
  const statement = db.prepare(query);
  return params.length ? await statement.bind(...params).first<T>() : await statement.first<T>();
}

async function run(db: D1Database, query: string, ...params: unknown[]) {
  const statement = db.prepare(query);
  return params.length ? statement.bind(...params).run() : statement.run();
}

function safeJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

async function envString(key: string): Promise<string | null> {
  const value = (await runtimeBindings())[key];
  return typeof value === "string" && value.length ? value : null;
}

async function envBoolean(key: string, fallback = false): Promise<boolean> {
  const value = await envString(key);
  return value ? value.toLowerCase() === "true" : fallback;
}

async function envNumber(key: string, fallback: number): Promise<number> {
  const value = Number(await envString(key));
  return Number.isFinite(value) ? value : fallback;
}

function settingValue(key: string, value: unknown): string {
  return JSON.stringify(value);
}

function setting(row: Row | undefined): unknown {
  return row ? safeJson(row.value_json, null) : null;
}

export async function ensureDemoData(): Promise<void> {
  const db = await requireDb();
  const marker = await first<Row>(db, "SELECT value_json FROM app_settings WHERE key = ?", "seed_version");
  const now = nowIso();

  if (marker) {
    await run(db, "UPDATE quotes SET observed_at = ?, is_fresh = 1 WHERE id LIKE 'demo-%'", now);
    await seedProfessionalSources(db, now);
    return;
  }

  const markets = [
    {
      group: "ff-target-rate",
      question: "Will the US Fed Funds Target Rate be above 5.00% on 8 December 2026?",
      symbol: "FF",
      provider: "ForecastEx",
      exchange: "FORECASTX",
      expiration: "2026-12-08T19:00:00.000Z",
      resolution: "Resolves from the official rate publication identified by the contract rules.",
      yes: 0.58,
      no: 0.42,
      strike: 5,
    },
    {
      group: "us-cpi-print",
      question: "Will US CPI be above 3.00% for the October 2026 release?",
      symbol: "CPI",
      provider: "ForecastEx",
      exchange: "FORECASTX",
      expiration: "2026-11-12T13:30:00.000Z",
      resolution: "Resolves from the relevant official US CPI release under the contract rules.",
      yes: 0.42,
      no: 0.58,
      strike: 3,
    },
    {
      group: "gold-settlement",
      question: "Will the CME gold futures event settle higher at the end of the session?",
      symbol: "GC",
      provider: "CME Group",
      exchange: "COMEX",
      expiration: "2026-09-30T20:00:00.000Z",
      resolution: "Resolves using the applicable CME futures settlement methodology.",
      yes: 0.46,
      no: 0.54,
      strike: 4000,
    },
  ];

  const statements: D1PreparedStatement[] = [];
  const settingRows: Array<[string, unknown]> = [
    ["seed_version", "1"],
    ["mode", DEFAULT_SETTINGS.mode],
    ["manualApprovalRequired", DEFAULT_SETTINGS.manualApprovalRequired],
    ["allowMarketOrders", DEFAULT_SETTINGS.allowMarketOrders],
    ["watchlist", DEFAULT_SETTINGS.watchlist],
    ["minEdge", DEFAULT_SETTINGS.minEdge],
    ["minConfidence", DEFAULT_SETTINGS.minConfidence],
    ["maxPositionPerContractUsd", DEFAULT_SETTINGS.maxPositionPerContractUsd],
    ["maxTotalExposureUsd", DEFAULT_SETTINGS.maxTotalExposureUsd],
    ["maxOrderSizeUsd", DEFAULT_SETTINGS.maxOrderSizeUsd],
    ["maxDailyLossUsd", DEFAULT_SETTINGS.maxDailyLossUsd],
    ["startingCapitalUsd", DEFAULT_SETTINGS.startingCapitalUsd],
    ["minAccountFloorPercent", DEFAULT_SETTINGS.minAccountFloorPercent],
    ["orderTimeoutSeconds", DEFAULT_SETTINGS.orderTimeoutSeconds],
    ["researchRefreshMinutes", DEFAULT_SETTINGS.researchRefreshMinutes],
    ["llmProvider", DEFAULT_SETTINGS.llmProvider],
    ["llmModel", DEFAULT_SETTINGS.llmModel],
    ["killSwitch", DEFAULT_SETTINGS.killSwitch],
    ["paperCash", DEFAULT_SETTINGS.startingCapitalUsd],
  ];

  for (const [key, value] of settingRows) {
    statements.push(
      db.prepare(
        "INSERT OR IGNORE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)",
      ).bind(key, settingValue(key, value), now),
    );
  }

  for (const [index, market] of markets.entries()) {
    const yesId = `demo-${market.group}-yes`;
    const noId = `demo-${market.group}-no`;
    const base = {
      market,
      secType: market.provider === "CME Group" ? "FOP" : "OPT",
      status: "paper_only",
      permissionStatus: "not_checked",
      eligible: 0,
      origin: "demo",
    };
    for (const outcome of ["YES", "NO"] as const) {
      const contractId = outcome === "YES" ? yesId : noId;
      const price = outcome === "YES" ? market.yes : market.no;
      const conid = 900000000 + index * 10 + (outcome === "YES" ? 1 : 2);
      const localSymbol = `${market.symbol} ${market.expiration.slice(0, 10)} ${market.strike} ${outcome}`;
      statements.push(
        db.prepare(
          `INSERT OR IGNORE INTO contracts
            (id, market_group, ibkr_conid, provider, exchange, symbol, sec_type, trading_class,
             question, outcome, settlement_value, expiration, resolution_criteria, currency,
             tick_size, minimum_quantity, bid, ask, last_price, status, permission_status,
             eligible, last_trade_at, expected_resolution_at, strike, local_symbol, data_origin,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          contractId,
          market.group,
          conid,
          market.provider,
          market.exchange,
          market.symbol,
          base.secType,
          market.symbol,
          market.question,
          outcome,
          1,
          market.expiration,
          market.resolution,
          "USD",
          market.provider === "CME Group" ? 1 : 0.01,
          1,
          Math.max(0, price - 0.01),
          Math.min(1, price + 0.01),
          price,
          base.status,
          base.permissionStatus,
          base.eligible,
          market.expiration,
          market.expiration,
          market.strike,
          localSymbol,
          base.origin,
          now,
          now,
        ),
      );
      statements.push(
        db.prepare(
          `INSERT OR IGNORE INTO quotes
             (id, contract_id, bid, ask, bid_size, ask_size, last_price, high_bid, buy_yes_now_at, is_fresh, observed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          `demo-${market.group}-${outcome.toLowerCase()}-quote`,
          contractId,
          Math.max(0, price - 0.01),
          Math.min(1, price + 0.01),
          outcome === "YES" ? 120 - index * 10 : 95 - index * 8,
          outcome === "YES" ? 85 + index * 6 : 110 - index * 5,
          price,
          Math.max(0, price - 0.01),
          price,
          1,
          now,
        ),
      );
    }
  }

  const researchId = "research_demo_ff_target_rate";
  const evidence = [
    {
      title: "IBKR event contracts documentation",
      url: "https://www.interactivebrokers.com/campus/ibkr-api-page/event-contracts/",
      publishedAt: now,
      source: "IBKR reference",
    },
    {
      title: "IBKR TWS event trading methods",
      url: "https://www.interactivebrokers.com/campus/ibkr-api-page/event-trading/",
      publishedAt: now,
      source: "IBKR reference",
    },
  ];
  statements.push(
    db.prepare(
      `INSERT OR IGNORE INTO research_runs
       (id, contract_id, status, provider, analyst_probability, confidence, reasoning_summary, uncertainties_json, evidence_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      researchId,
      "demo-ff-target-rate-yes",
      "completed",
      "deterministic",
      0.68,
      0.72,
      "Illustrative baseline estimate: the market price is treated as a prior and adjusted modestly for the configured demo scenario. This is not a live forecast.",
      JSON.stringify(["Demo data is not connected to live economic releases.", "The account has not been permission-checked."]),
      JSON.stringify(evidence),
      now,
      now,
    ),
  );
  statements.push(
    db.prepare(
      `INSERT OR IGNORE INTO probability_estimates
       (id, contract_id, research_run_id, estimated_probability, confidence, net_edge, source, assumptions_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      "estimate_demo_ff_target_rate",
      "demo-ff-target-rate-yes",
      researchId,
      0.68,
      0.72,
      0.0824,
      "deterministic",
      JSON.stringify(["Demo market prices are illustrative.", "No live account or permissions are connected."]),
      now,
    ),
  );
  statements.push(
    db.prepare(
      `INSERT OR IGNORE INTO trade_proposals
       (id, contract_id, outcome, direction, current_quote, estimated_probability, gross_edge, net_edge,
        max_entry_price, quantity, notional_value, confidence, evidence_json, risk_check_results_json,
        status, expires_at, mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      "proposal_demo_ff_target_rate",
      "demo-ff-target-rate-yes",
      "YES",
      "BUY",
      0.59,
      0.68,
      0.09,
      0.0824,
      0.65,
      20,
      11.8,
      0.72,
      JSON.stringify(evidence),
      JSON.stringify([
        { key: "kill_switch", label: "Kill switch inactive", pass: true },
        { key: "position_cap", label: "Per-contract cap", pass: true },
        { key: "aggregate_cap", label: "Aggregate exposure cap", pass: true },
        { key: "order_cap", label: "Maximum order size", pass: true },
      ]),
      "pending",
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      "paper",
      now,
      now,
    ),
  );
  for (const item of evidence) {
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO proposal_evidence
         (id, proposal_id, title, url, published_at, source) VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        id("evidence"),
        "proposal_demo_ff_target_rate",
        item.title,
        item.url,
        item.publishedAt,
        item.source,
      ),
    );
  }
  statements.push(
    db.prepare(
      `INSERT OR IGNORE INTO portfolio_snapshots
       (id, cash, portfolio_value, daily_pnl, drawdown, total_return, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id("snapshot"), 1000, 1000, 0, 0, 0, now),
  );

  await db.batch(statements);
  await seedProfessionalSources(db, now);
}

async function seedProfessionalSources(db: D1Database, now: string): Promise<void> {
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO data_sources (id, name, kind, endpoint, reliability, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
      .bind("source_ecb", "European Central Bank", "official_api", "https://data-api.ecb.europa.eu", 0.98, now, now),
    db.prepare(`INSERT OR IGNORE INTO data_sources (id, name, kind, endpoint, reliability, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
      .bind("source_cso", "Central Statistics Office Ireland", "official_api", "https://ws.cso.ie", 0.98, now, now),
    db.prepare(`INSERT OR IGNORE INTO data_sources (id, name, kind, endpoint, reliability, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
      .bind("source_ibkr", "Interactive Brokers bridge", "broker", null, 1, now, now),
    db.prepare(`INSERT OR IGNORE INTO data_sources (id, name, kind, endpoint, reliability, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
      .bind("source_rss", "Configured RSS / Atom feeds", "rss", null, 0.7, now, now),
  ]);
}

export async function getSettings(): Promise<Settings> {
  const db = await requireDb();
  const rows = await all<Row>(db, "SELECT key, value_json FROM app_settings");
  const values = new Map(rows.map((row) => [String(row.key), setting(row)]));
  const runtimeLive = await envBoolean("LIVE_TRADING_ENABLED", false);
  const runtimeMode = await envString("TRADING_MODE");
  const bridgeConfigured = Boolean(await envString("IBKR_BRIDGE_TOKEN"));
  return {
    ...DEFAULT_SETTINGS,
    mode: values.get("mode") === "live" && runtimeMode === "live" ? "live" : "paper",
    paperExecutionTarget: values.get("paperExecutionTarget") === "site" ? "site" : "ibkr",
    manualApprovalRequired: (await envBoolean("MANUAL_APPROVAL_REQUIRED", true)) && values.get("manualApprovalRequired") !== false,
    allowMarketOrders: (await envBoolean("ALLOW_MARKET_ORDERS", false)) && values.get("allowMarketOrders") === true,
    watchlist: Array.isArray(values.get("watchlist")) ? (values.get("watchlist") as string[]) : [],
    minEdge: numberOr(values.get("minEdge"), DEFAULT_SETTINGS.minEdge),
    minConfidence: numberOr(values.get("minConfidence"), DEFAULT_SETTINGS.minConfidence),
    maxPositionPerContractUsd: numberOr(values.get("maxPositionPerContractUsd"), DEFAULT_SETTINGS.maxPositionPerContractUsd),
    maxTotalExposureUsd: numberOr(values.get("maxTotalExposureUsd"), DEFAULT_SETTINGS.maxTotalExposureUsd),
    maxOrderSizeUsd: numberOr(values.get("maxOrderSizeUsd"), DEFAULT_SETTINGS.maxOrderSizeUsd),
    maxDailyLossUsd: numberOr(values.get("maxDailyLossUsd"), DEFAULT_SETTINGS.maxDailyLossUsd),
    startingCapitalUsd: numberOr(values.get("startingCapitalUsd"), DEFAULT_SETTINGS.startingCapitalUsd),
    minAccountFloorPercent: numberOr(values.get("minAccountFloorPercent"), DEFAULT_SETTINGS.minAccountFloorPercent),
    maxConcurrentOrders: numberOr(values.get("maxConcurrentOrders"), await envNumber("MAX_CONCURRENT_ORDERS", DEFAULT_SETTINGS.maxConcurrentOrders)),
    maxSlippagePercent: numberOr(values.get("maxSlippagePercent"), await envNumber("MAX_SLIPPAGE_PERCENT", DEFAULT_SETTINGS.maxSlippagePercent)),
    orderTimeoutSeconds: numberOr(values.get("orderTimeoutSeconds"), DEFAULT_SETTINGS.orderTimeoutSeconds),
    researchRefreshMinutes: numberOr(values.get("researchRefreshMinutes"), DEFAULT_SETTINGS.researchRefreshMinutes),
    newsRssUrls: typeof values.get("newsRssUrls") === "string" && String(values.get("newsRssUrls")).trim().length > 0 ? String(values.get("newsRssUrls")) : (await envString("NEWS_RSS_URLS") ?? DEFAULT_SETTINGS.newsRssUrls),
    llmProvider: values.get("llmProvider") === "openai" ? "openai" : "deterministic",
    llmModel: typeof values.get("llmModel") === "string" ? String(values.get("llmModel")) : DEFAULT_SETTINGS.llmModel,
    killSwitch: values.get("killSwitch") === true,
    liveTradingEnabled: runtimeLive && values.get("liveTradingEnabled") !== false,
    bridgeConfigured,
    paperCash: numberOr(values.get("paperCash"), numberOr(values.get("startingCapitalUsd"), DEFAULT_SETTINGS.startingCapitalUsd)),
  };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export async function saveSettings(input: Record<string, unknown>): Promise<Settings> {
  const db = await requireDb();
  const allowed = new Set([
    "mode",
    "paperExecutionTarget",
    "manualApprovalRequired",
    "allowMarketOrders",
    "watchlist",
    "minEdge",
    "minConfidence",
    "maxPositionPerContractUsd",
    "maxTotalExposureUsd",
    "maxOrderSizeUsd",
    "maxDailyLossUsd",
    "startingCapitalUsd",
    "minAccountFloorPercent",
    "maxConcurrentOrders",
    "maxSlippagePercent",
    "orderTimeoutSeconds",
    "researchRefreshMinutes",
    "newsRssUrls",
    "llmProvider",
    "llmModel",
  ]);
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) continue;
    if (key === "mode" && value !== "paper" && value !== "live") continue;
    if (key === "paperExecutionTarget" && value !== "ibkr" && value !== "site") continue;
    statements.push(
      db.prepare(
        `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      ).bind(key, settingValue(key, value), now),
    );
  }
  if (statements.length) await db.batch(statements);
  return getSettings();
}

export type Market = {
  id: string;
  question: string;
  provider: string;
  exchange: string;
  expiration: string;
  resolutionCriteria: string;
  currency: string;
  status: string;
  permissionStatus: string;
  eligible: boolean;
  dataOrigin: string;
  resolutionStatus: string;
  resolutionSourceName: string | null;
  resolutionSourceUrl: string | null;
  measurementPeriod: string | null;
  ambiguityScore: number;
  quality?: { score: number; components: Record<string, number> };
  yes: ContractSide | null;
  no: ContractSide | null;
};

export type ContractSide = {
  contractId: string;
  conid: number | null;
  outcome: string;
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  eligible: boolean;
  lastPrice: number | null;
  price: number | null;
  quoteObservedAt: string | null;
  quoteFresh: boolean;
  tickSize: number;
  minimumQuantity: number;
  localSymbol: string | null;
  strike: number | null;
};

export async function getMarkets(): Promise<Market[]> {
  const db = await requireDb();
  await ensureDemoData();
  const rows = await all<Row>(
    db,
    `SELECT c.*, q.bid AS quote_bid, q.ask AS quote_ask, q.bid_size AS quote_bid_size, q.ask_size AS quote_ask_size, q.last_price AS quote_last_price,
            q.observed_at AS quote_observed_at, q.is_fresh AS quote_is_fresh
     FROM contracts c
     LEFT JOIN quotes q ON q.id = (
       SELECT q2.id FROM quotes q2 WHERE q2.contract_id = c.id ORDER BY q2.observed_at DESC LIMIT 1
     )
     ORDER BY c.expiration ASC, c.question ASC, c.outcome ASC`,
  );
  const groups = new Map<string, Market>();
  for (const row of rows) {
    const group = String(row.market_group);
    const current = groups.get(group) ?? {
      id: group,
      question: String(row.question),
      provider: String(row.provider),
      exchange: String(row.exchange),
      expiration: String(row.expiration),
      resolutionCriteria: String(row.resolution_criteria ?? ""),
      currency: String(row.currency ?? "USD"),
      status: String(row.status),
      permissionStatus: String(row.permission_status),
      eligible: Boolean(row.eligible),
      dataOrigin: String(row.data_origin ?? "ibkr_bridge"),
      resolutionStatus: String(row.resolution_status ?? "unclear"),
      resolutionSourceName: row.resolution_source_name ? String(row.resolution_source_name) : null,
      resolutionSourceUrl: row.resolution_source_url ? String(row.resolution_source_url) : null,
      measurementPeriod: row.measurement_period ? String(row.measurement_period) : null,
      ambiguityScore: Number(row.ambiguity_score ?? 1),
      yes: null,
      no: null,
    };
    const side: ContractSide = {
      contractId: String(row.id),
      conid: row.ibkr_conid == null ? null : Number(row.ibkr_conid),
      outcome: String(row.outcome),
      bid: nullableNumber(row.quote_bid ?? row.bid),
      ask: nullableNumber(row.quote_ask ?? row.ask),
      bidSize: nullableNumber(row.quote_bid_size),
      askSize: nullableNumber(row.quote_ask_size),
      eligible: Boolean(row.eligible),
      lastPrice: nullableNumber(row.quote_last_price ?? row.last_price),
      price: nullableNumber(row.quote_ask ?? row.ask ?? row.quote_last_price ?? row.last_price ?? row.bid),
      quoteObservedAt: row.quote_observed_at ? String(row.quote_observed_at) : null,
      quoteFresh: Boolean(row.quote_is_fresh) && freshQuote(String(row.quote_observed_at ?? ""), 90),
      tickSize: Number(row.tick_size ?? 0.01),
      minimumQuantity: Number(row.minimum_quantity ?? 1),
      localSymbol: row.local_symbol ? String(row.local_symbol) : null,
      strike: nullableNumber(row.strike),
    };
    if (String(row.outcome).toUpperCase() === "YES") current.yes = side;
    if (String(row.outcome).toUpperCase() === "NO") current.no = side;
    groups.set(group, current);
  }
  return [...groups.values()].map((market) => ({
    ...market,
    eligible: Boolean(market.yes?.contractId && market.no?.contractId && market.yes?.eligible && market.no?.eligible),
    quality: scoreMarketQuality({
      spread: market.yes?.ask != null && market.yes?.bid != null ? market.yes.ask - market.yes.bid : 1,
      availableSize: Math.min(market.yes?.askSize ?? 0, market.no?.askSize ?? 0),
      quoteAgeSeconds: market.yes?.quoteObservedAt ? (Date.now() - Date.parse(market.yes.quoteObservedAt)) / 1000 : Infinity,
      resolutionClarity: Math.max(0, 1 - Number(market.ambiguityScore ?? 1)),
      evidenceFreshness: 0,
      sourceReliability: market.dataOrigin === "demo" ? 0 : 1,
      permissionEligible: Boolean(market.yes?.eligible && market.no?.eligible),
      slippage: 0.015,
    }),
  }));
}

function nullableNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function getContract(contractId: string): Promise<Row | null> {
  const db = await requireDb();
  await ensureDemoData();
  return first<Row>(db, "SELECT * FROM contracts WHERE id = ?", contractId);
}

export async function getProposalRows(): Promise<Row[]> {
  const db = await requireDb();
  await ensureDemoData();
  const rows = await all<Row>(
    db,
    `SELECT p.*, c.question, c.provider, c.exchange, c.expiration, c.resolution_criteria,
            c.symbol, c.data_origin, c.status AS contract_status
     FROM trade_proposals p JOIN contracts c ON c.id = p.contract_id
     ORDER BY CASE p.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, p.created_at DESC`,
  );
  return rows.map(deserializeProposal);
}

function deserializeProposal(row: Row): Row {
  return {
    ...row,
    evidence: safeJson(row.evidence_json, []),
    riskChecks: safeJson(row.risk_check_results_json, []),
  };
}

export async function getOrderRows(): Promise<Row[]> {
  const db = await requireDb();
  await ensureDemoData();
  return all<Row>(
    db,
    `SELECT o.*, c.question, c.provider, c.exchange, c.outcome
     FROM orders o JOIN contracts c ON c.id = o.contract_id ORDER BY o.created_at DESC LIMIT 100`,
  );
}

export async function getPositionRows(): Promise<Row[]> {
  const db = await requireDb();
  await ensureDemoData();
  return all<Row>(
    db,
    `SELECT p.*, c.question, c.expiration, c.exchange, c.data_origin
     FROM positions p JOIN contracts c ON c.id = p.contract_id
     ORDER BY p.status ASC, p.updated_at DESC`,
  );
}

export async function getPortfolioSummary(): Promise<Row> {
  const settings = await getSettings();
  const positions = await getPositionRows();
  const modePositions = positions.filter((row) => String(row.mode ?? "paper") === settings.mode);
  const openPositions = modePositions.filter((row) => Number(row.quantity ?? 0) > 0 && row.status !== "resolved");
  const markValue = openPositions.reduce((sum, row) => sum + Number(row.quantity ?? 0) * Number(row.mark_price ?? 0), 0);
  const costBasis = openPositions.reduce((sum, row) => sum + Number(row.cost_basis ?? 0), 0);
  const realisedPnl = modePositions.reduce((sum, row) => sum + Number(row.realised_pnl ?? 0), 0);
  const portfolioValue = settings.paperCash + markValue;
  const totalReturn = portfolioValue - settings.startingCapitalUsd;
  const drawdown = Math.min(0, totalReturn);
  const providerExposure = new Map<string, number>();
  for (const position of openPositions) {
    const provider = String(position.provider ?? "Unknown");
    providerExposure.set(provider, (providerExposure.get(provider) ?? 0) + Number(position.quantity ?? 0) * Number(position.mark_price ?? 0));
  }
  return {
    simulated: settings.mode !== "live",
    cash: settings.paperCash,
    markValue,
    portfolioValue,
    costBasis,
    unrealisedPnl: markValue - costBasis,
    realisedPnl,
    totalReturn,
    totalReturnPercent: settings.startingCapitalUsd ? totalReturn / settings.startingCapitalUsd : 0,
    dailyPnl: totalReturn,
    drawdown,
    positions: openPositions,
    resolvedPositions: modePositions.filter((row) => row.status === "resolved"),
    tradeHistory: (await getOrderRows()).filter((row) => String(row.mode ?? "paper") === settings.mode),
    exposureByProvider: [...providerExposure.entries()].map(([provider, exposure]) => ({ provider, exposure })),
  };
}

export async function getRiskSummary(): Promise<Row> {
  const settings = await getSettings();
  const portfolio = await getPortfolioSummary();
  const proposals = await getProposalRows();
  const openOrders = (await getOrderRows()).filter((row) => String(row.mode ?? "paper") === settings.mode && ["pending", "submitted", "partially_filled"].includes(String(row.status)));
  const exposureByContract = (portfolio.positions as Row[]).map((row) => ({
    contractId: String(row.contract_id),
    question: String(row.question ?? row.contract_id),
    exposure: Number(row.quantity ?? 0) * Number(row.mark_price ?? 0),
  }));
  const totalExposure = exposureByContract.reduce((sum, row) => sum + row.exposure, 0);
  const heartbeat = await latestHeartbeat();
  const bridgeFunds = heartbeat?.permissions && typeof heartbeat.permissions === "object" ? Number((heartbeat.permissions as Row).available_funds) : NaN;
  const breaches: Array<{ severity: string; message: string }> = [];
  if (settings.killSwitch) breaches.push({ severity: "high", message: "Kill switch is active." });
  if (Number(portfolio.dailyPnl) <= -settings.maxDailyLossUsd) breaches.push({ severity: "high", message: "Daily loss limit reached." });
  if (Number(portfolio.portfolioValue) < settings.startingCapitalUsd * settings.minAccountFloorPercent / 100) breaches.push({ severity: "high", message: "Portfolio is below the configured account floor." });
  if (totalExposure > settings.maxTotalExposureUsd) breaches.push({ severity: "medium", message: "Aggregate exposure exceeds the configured cap." });
  return {
    settings: {
      maxPositionPerContractUsd: settings.maxPositionPerContractUsd,
      maxTotalExposureUsd: settings.maxTotalExposureUsd,
      maxOrderSizeUsd: settings.maxOrderSizeUsd,
      maxDailyLossUsd: settings.maxDailyLossUsd,
      minAccountFloorPercent: settings.minAccountFloorPercent,
      maxConcurrentOrders: settings.maxConcurrentOrders,
      maxSlippagePercent: settings.maxSlippagePercent,
    },
    availableBalance: settings.mode === "live" && Number.isFinite(bridgeFunds) ? bridgeFunds : portfolio.cash,
    aggregateExposure: totalExposure,
    dailyPnl: Number(portfolio.dailyPnl),
    drawdown: Number(portfolio.drawdown),
    accountFloor: settings.startingCapitalUsd * settings.minAccountFloorPercent / 100,
    openOrders: openOrders.length,
    pendingProposals: proposals.filter((row) => row.status === "pending").length,
    exposureByContract,
    correlatedEventExposure: (portfolio.exposureByProvider as Row[]).filter((row) => Number(row.exposure) > 0).map((row) => ({
      group: `provider:${row.provider}`,
      exposure: row.exposure,
      note: "Provider-level grouping only; no event correlation was asserted.",
    })),
    concentration: totalExposure / Math.max(1, Number(portfolio.portfolioValue)),
    slippageEstimate: settings.maxSlippagePercent,
    breaches,
    tradingHalted: breaches.some((breach) => breach.severity === "high"),
    haltReason: breaches.find((breach) => breach.severity === "high")?.message ?? null,
    killSwitch: settings.killSwitch,
  };
}

export async function latestHeartbeat(): Promise<Row | null> {
  const db = await requireDb();
  const row = await first<Row>(db, "SELECT * FROM bridge_heartbeats ORDER BY observed_at DESC LIMIT 1");
  if (!row) return null;
  return {
    ...row,
    permissions: safeJson(row.permissions_json, {}),
  };
}

export async function latestBridgeStockSnapshot(ticker: string): Promise<Row | null> {
  const db = await requireDb();
  const row = await first<Row>(db, "SELECT value_json, updated_at FROM app_settings WHERE key = ?", `bridgeStockSnapshot:${ticker.trim().toUpperCase()}`);
  if (!row) return null;
  return { snapshot: safeJson(row.value_json, null), updatedAt: row.updated_at };
}

export async function bridgeJob(jobId: string): Promise<Row | null> {
  const db = await requireDb();
  return first<Row>(db, "SELECT id, status, error_message FROM jobs WHERE id = ?", jobId);
}

export async function getStatus() {
  await ensureDemoData();
  const [settings, portfolio, risk, proposals, orders, heartbeat, dataHealth, agents, forecastAnalytics, alpaca, decisionLayer, professionalAnalytics] = await Promise.all([
    getSettings(),
    getPortfolioSummary(),
    getRiskSummary(),
    getProposalRows(),
    getOrderRows(),
    latestHeartbeat(),
    getDataHealth(),
    getAgentStatus(),
    getForecastAnalytics(),
    getAlpacaSummary(),
    getDecisionLayer(),
    getProfessionalAnalytics(),
  ]);
  const heartbeatAge = heartbeat ? Date.now() - Date.parse(String(heartbeat.observed_at)) : Infinity;
  const bridgeState = !heartbeat ? "unavailable" : heartbeatAge > 60_000 ? "stale" : "connected";
  const permissions = heartbeat?.permissions as Record<string, unknown> | undefined;
  return {
    mode: settings.mode,
    simulated: settings.mode !== "live",
    liveTradingEnabled: settings.liveTradingEnabled,
    manualApprovalRequired: settings.manualApprovalRequired,
    bridge: {
      state: bridgeState,
      configured: settings.bridgeConfigured,
      bridgeId: heartbeat?.bridge_id ?? null,
      lastHeartbeat: heartbeat?.observed_at ?? null,
      permissions: permissions ?? null,
    },
    ibkr: {
      connection: heartbeat ? String(heartbeat.status) : "not connected",
      accountId: heartbeat?.account_id ?? null,
      balance: permissions?.available_funds ?? null,
      eventContractsPermission: permissions?.event_contracts ?? "not checked",
    },
    risk,
    portfolio,
    proposals: proposals.slice(0, 8),
    openOrders: orders.filter((row) => ["pending", "submitted", "partially_filled"].includes(String(row.status))).length,
    lastDataRefresh: nowIso(),
    killSwitch: settings.killSwitch,
    settings: {
      ...settings,
      bridgeConfigured: settings.bridgeConfigured,
    },
    dataHealth,
    agents,
    forecastAnalytics,
    alpaca,
    decisionLayer,
    professionalAnalytics,
  };
}

export async function getDecisionLayer(): Promise<Row> {
  const markets = await getMarkets();
  const ranked = markets.map((market) => ({
    id: market.id,
    question: market.question,
    provider: market.provider,
    rank: rankOpportunity({ netEdge: 0, confidence: 0.5, marketQuality: market.quality?.score ?? 0, resolutionReady: market.resolutionStatus === "verified", quoteFresh: Boolean(market.yes?.quoteFresh && market.no?.quoteFresh), liquidity: Math.min(market.yes?.askSize ?? 0, market.no?.askSize ?? 0) }),
    quality: market.quality?.score ?? 0,
    status: market.status,
  })).sort((a, b) => b.rank - a.rank).slice(0, 8);
  const calendar = markets.map((market) => ({ id: market.id, question: market.question, provider: market.provider, expiration: market.expiration, resolutionStatus: market.resolutionStatus })).sort((a, b) => Date.parse(a.expiration) - Date.parse(b.expiration)).slice(0, 8);
  return { ranked, calendar, policy: "Ranking is a triage aid; no opportunity bypasses resolution, quote, approval or risk gates." };
}

export async function getAlpacaSummary(): Promise<Row> {
  const db = await requireDb();
  const configured = Boolean(await envString("ALPACA_ENABLED")) && (await envBoolean("ALPACA_ENABLED"));
  const settingRow = await first<Row>(db, "SELECT value_json, updated_at FROM app_settings WHERE key = 'alpacaSnapshot'");
  const snapshot = safeJson<Row>(settingRow?.value_json, {});
  const lastSync = typeof snapshot.observed_at === "string" ? snapshot.observed_at : null;
  const age = lastSync ? Date.now() - Date.parse(lastSync) : Infinity;
  return {
    enabled: configured,
    state: !configured ? "disabled" : !lastSync ? "awaiting_data" : age > 120_000 ? "stale" : snapshot.status === "connected" ? "connected" : "unavailable",
    paperOnly: true,
    liveOrders: false,
    lastSync,
    account: snapshot.account ?? null,
    snapshots: Array.isArray(snapshot.snapshots) ? snapshot.snapshots : [],
    cryptoSnapshots: Array.isArray(snapshot.crypto_snapshots) ? snapshot.crypto_snapshots : [],
    news: Array.isArray(snapshot.news) ? snapshot.news : [],
    error: snapshot.error ?? null,
  };
}

export async function getDataHealth(): Promise<Row> {
  const db = await requireDb();
  await ensureDemoData();
  const sources = await all<Row>(db, `SELECT id, name, kind, endpoint, reliability, enabled, last_success_at, last_error, updated_at FROM data_sources ORDER BY name`);
  const latestMarket = await first<Row>(db, "SELECT MAX(observed_at) AS observed_at, COUNT(*) AS count FROM market_snapshots");
  const latestForecast = await first<Row>(db, "SELECT MAX(observed_at) AS observed_at, COUNT(*) AS count FROM forecast_snapshots");
  const quality = await all<Row>(db, "SELECT severity, event_type, message, created_at FROM data_quality_events ORDER BY created_at DESC LIMIT 8");
  return {
    sources,
    marketSnapshots: Number(latestMarket?.count ?? 0),
    lastMarketSnapshot: latestMarket?.observed_at ?? null,
    forecastSnapshots: Number(latestForecast?.count ?? 0),
    lastForecastSnapshot: latestForecast?.observed_at ?? null,
    qualityEvents: quality,
    status: sources.some((source) => source.enabled && source.last_error) ? "degraded" : sources.some((source) => source.last_success_at) ? "healthy" : "awaiting_data",
  };
}

export async function getAgentStatus(): Promise<Row> {
  const db = await requireDb();
  const managerModel = (await envString("MANAGER_MODEL")) ?? "5.6 Luna Max";
  const workerModel = (await envString("WORKER_MODEL")) ?? "5.6 Luna Medium";
  const runs = await all<Row>(db, "SELECT id, role, model, task_type, contract_id, status, started_at, completed_at, created_at FROM agent_runs ORDER BY created_at DESC LIMIT 10");
  return {
    manager: { role: "manager", model: managerModel, responsibility: "Evidence review, uncertainty checks, risk-aware proposal drafting" },
    worker: { role: "worker", model: workerModel, responsibility: "Read-only collection, normalization and deterministic calculations" },
    runs,
    policy: "Agents can produce research and proposals only. Human approval and broker risk gates remain mandatory.",
  };
}

export async function getForecastAnalytics(): Promise<Row> {
  const db = await requireDb();
  await ensureDemoData();
  const forecasts = await all<Row>(db, `SELECT f.*, c.market_group, c.question, c.outcome AS contract_outcome
    FROM forecast_snapshots f LEFT JOIN contracts c ON c.id = f.contract_id ORDER BY f.observed_at ASC`);
  const scored = forecasts.filter((row) => row.outcome !== null && row.outcome !== undefined).map((row) => ({ probability: Number(row.estimated_probability), outcome: Number(row.outcome) }));
  const metrics = scoringMetrics(scored);
  const walkForward = walkForwardBrier({ forecasts: forecasts.map((row) => ({ probability: row.estimated_probability, outcome: row.outcome, observedAt: row.observed_at })) });
  const latest = forecasts.slice(-20).reverse().map((row) => ({ contractId: row.contract_id, question: row.question, probability: row.estimated_probability, marketProbability: row.market_probability, netEdge: row.net_edge, outcome: row.outcome, observedAt: row.observed_at }));
  return { ...metrics, walkForward, forecasts: latest, postmortems: forecasts.filter((row) => row.outcome !== null && row.outcome !== undefined).slice(-20).reverse().map((row) => ({ question: row.question, forecast: row.estimated_probability, market: row.market_probability, outcome: row.outcome, forecastError: Number(row.estimated_probability) - Number(row.outcome), observedAt: row.observed_at })), pendingResolutionCount: forecasts.filter((row) => row.outcome === null || row.outcome === undefined).length };
}

export async function getProfessionalAnalytics(): Promise<Row> {
  const db = await requireDb();
  await ensureDemoData();
  const forecasts = await all<Row>(db, "SELECT estimated_probability AS probability, outcome, confidence, market_probability, net_edge, observed_at AS observedAt FROM forecast_snapshots ORDER BY observed_at ASC");
  const calibration = calibrationDiagnostics(forecasts);
  const abstention = abstentionDiagnostics({ forecasts, minimumConfidence: (await getSettings()).minConfidence });
  const purgedWalkForward = purgedWalkForwardBrier({ forecasts: forecasts.map((row) => ({ probability: row.probability, outcome: row.outcome, observedAt: row.observedAt })), minimumTraining: 5, purgeDays: 1, embargoDays: 1 });
  const execution = await all<Row>(db, `SELECT o.id, o.status, o.quantity, o.limit_price, o.created_at, COALESCE(SUM(f.quantity), 0) AS filled_quantity, AVG(f.price) AS avg_fill_price
    FROM orders o LEFT JOIN fills f ON f.order_id = o.id GROUP BY o.id ORDER BY o.created_at DESC LIMIT 100`);
  const executionRows = execution.map((row) => ({ edge: Number(row.avg_fill_price ?? row.limit_price) - Number(row.limit_price), observedAt: row.created_at }));
  const portfolioSnapshots = await all<Row>(db, "SELECT portfolio_value, daily_pnl, drawdown, created_at FROM portfolio_snapshots WHERE mode = 'paper' ORDER BY created_at ASC LIMIT 500");
  const positions = await all<Row>(db, "SELECT cost_basis AS exposure FROM positions WHERE status = 'open'");
  const settings = await getSettings();
  const capital = Number(portfolioSnapshots.at(-1)?.portfolio_value ?? settings.startingCapitalUsd);
  const stress = stressTestPortfolio({ exposures: positions, capital });
  const contracts = await all<Row>(db, "SELECT id, question, resolution_criteria AS resolutionCriteria, resolution_source_url AS resolutionSourceUrl, expiration, ambiguity_score AS ambiguityScore, provider FROM contracts ORDER BY updated_at DESC");
  const integrity = contracts.map((contract) => ({ id: contract.id, question: contract.question, provider: contract.provider, ...resolutionIntegrity(contract) }));
  if (contracts.length) {
    const versionStatements = contracts.map((contract) => db.prepare(`INSERT OR IGNORE INTO contract_versions (id, contract_id, version_hash, question, resolution_criteria, resolution_source_url, changed_fields_json, observed_at) VALUES (?, ?, ?, ?, ?, ?, '[]', ?)`)
      .bind(`version:${contract.id}:${String(contract.resolutionCriteria ?? "").length}:${String(contract.resolutionSourceUrl ?? "")}`, contract.id, `${String(contract.id)}:${String(contract.question)}:${String(contract.resolutionCriteria)}:${String(contract.resolutionSourceUrl ?? "")}`, contract.question, contract.resolutionCriteria, contract.resolutionSourceUrl ?? null, nowIso()));
    await db.batch(versionStatements);
  }
  const attribution = await all<Row>(db, "SELECT * FROM decision_attributions ORDER BY created_at DESC LIMIT 100");
  const correlationEdges = await all<Row>(db, "SELECT source_contract_id AS sourceId, target_contract_id AS targetId, relationship, confidence, cap FROM correlation_edges");
  const edgeRows = forecasts.map((row) => ({ segment: String(row.provider ?? "all"), edge: row.net_edge, confidence: row.confidence, probability: row.probability, outcome: row.outcome }));
  const fillSimulations = execution.slice(0, 50).map((row) => simulateLimitFill({ quantity: row.quantity, ask: row.avg_fill_price ?? row.limit_price, askSize: row.filled_quantity, limitPrice: row.limit_price, queueFactor: 1 }));
  const exposures = positions.map((row) => ({ contractId: row.contract_id, exposure: Number(row.exposure ?? 0) }));
  return {
    calibration,
    abstention,
    purgedWalkForward,
    edgeMap: forecastEdgeMap(edgeRows),
    edgeDecay: edgeDecay(executionRows),
    execution: {
      sampleSize: execution.length,
      filledOrders: execution.filter((row) => ["filled", "partially_filled"].includes(String(row.status))).length,
      fillRate: execution.length ? execution.reduce((sum, row) => sum + Math.min(1, Number(row.filled_quantity ?? 0) / Math.max(1, Number(row.quantity ?? 0))), 0) / execution.length : null,
      averageSlippage: executionRows.length ? executionRows.reduce((sum, row) => sum + row.edge, 0) / executionRows.length : null,
    },
    stressTests: stress,
    resolutionIntegrity: integrity,
    attribution,
    correlationWarnings: correlationWarnings(exposures, correlationEdges),
    fillSimulations,
    snapshots: portfolioSnapshots.slice(-30).map((row) => ({ value: row.portfolio_value, dailyPnl: row.daily_pnl, drawdown: row.drawdown, createdAt: row.created_at })),
    lineage: { forecastSnapshots: forecasts.length, marketSnapshots: Number((await first<Row>(db, "SELECT COUNT(*) AS count FROM market_snapshots"))?.count ?? 0), auditEvents: Number((await first<Row>(db, "SELECT COUNT(*) AS count FROM audit_log"))?.count ?? 0) },
    policy: "Diagnostics are computed from timestamped Site records. The benchmark vault preserves contract integrity, forecast, execution and decision context; no metric is evidence of future profit.",
  };
}

export async function startAgentWorkflow(contractId: string, viewer: Viewer): Promise<Row> {
  const db = await requireDb();
  const contract = await first<Row>(db, "SELECT id, question FROM contracts WHERE id = ?", contractId);
  if (!contract) throw new ApiError("Contract not found", 404, "contract_not_found");
  const workflowId = id("agent_workflow");
  const now = nowIso();
  const managerModel = (await envString("MANAGER_MODEL")) ?? "5.6 Luna Max";
  const workerModel = (await envString("WORKER_MODEL")) ?? "5.6 Luna Medium";
  await db.batch([
    db.prepare(`INSERT INTO agent_runs (id, role, model, task_type, contract_id, status, input_json, created_at) VALUES (?, 'worker', ?, 'research_collection', ?, 'queued', ?, ?)`)
      .bind(`${workflowId}:worker`, workerModel, contractId, JSON.stringify({ contractId, requestedBy: viewer.id }), now),
    db.prepare(`INSERT INTO agent_runs (id, role, model, task_type, contract_id, status, input_json, created_at) VALUES (?, 'manager', ?, 'evidence_review', ?, 'queued', ?, ?)`)
      .bind(`${workflowId}:manager`, managerModel, contractId, JSON.stringify({ contractId, dependsOn: `${workflowId}:worker` }), now),
    db.prepare(`INSERT INTO jobs (id, type, payload_json, status, attempt_count, idempotency_key, created_at, updated_at) VALUES (?, 'research', ?, 'pending', 0, ?, ?, ?)`)
      .bind(workflowId, JSON.stringify({ contractId, workerRunId: `${workflowId}:worker`, managerRunId: `${workflowId}:manager` }), `agent:${contractId}:${Math.floor(Date.now() / 60000)}`, now, now),
    db.prepare(`INSERT INTO audit_log (id, actor, action, entity_type, entity_id, payload_json, created_at) VALUES (?, ?, 'agent_workflow_queued', 'agent_workflow', ?, ?, ?)`)
      .bind(id("audit"), viewer.id, workflowId, JSON.stringify({ contractId, managerModel, workerModel }), now),
  ]);
  await run(db, "UPDATE agent_runs SET status = 'processing', started_at = ? WHERE id = ?", now, `${workflowId}:worker`);
  try {
    const result = await runResearch(contractId, viewer);
    const completed = nowIso();
    const output = JSON.stringify({ proposalId: (result.proposal as Row | null)?.id ?? null, estimate: result.estimate });
    await db.batch([
      db.prepare("UPDATE agent_runs SET status = 'completed', output_json = ?, completed_at = ? WHERE id = ?").bind(JSON.stringify({ evidence: result.estimate.evidence }), completed, `${workflowId}:worker`),
      db.prepare("UPDATE agent_runs SET status = 'completed', started_at = ?, output_json = ?, completed_at = ? WHERE id = ?").bind(completed, output, completed, `${workflowId}:manager`),
      db.prepare("UPDATE jobs SET status = 'completed', updated_at = ? WHERE id = ?").bind(completed, workflowId),
      db.prepare("INSERT INTO agent_decisions (id, run_id, decision, rationale, evidence_json, supporting_evidence_json, contradictory_evidence_json, what_would_change, strongest_no_trade_reason, requires_approval, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)")
        .bind(id("decision"), `${workflowId}:manager`, result.proposal ? "proposal_created" : "research_only", result.proposal ? "Evidence and risk gates passed; manual approval remains required." : "No proposal passed the configured edge, confidence or data gates.", JSON.stringify(result.estimate.evidence), JSON.stringify(result.estimate.evidence), JSON.stringify(result.estimate.uncertainties), "A new verified official release, a change to the resolution rule, or a material quote move.", result.proposal ? "The strongest remaining risk is uncertainty in the evidence and execution price." : "The strongest reason not to trade is that the configured proposal gates were not all passed.", completed),
    ]);
    return { workflowId, workerRunId: `${workflowId}:worker`, managerRunId: `${workflowId}:manager`, status: "completed", result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent workflow failed";
    await db.batch([
      db.prepare("UPDATE agent_runs SET status = 'failed', error_message = ?, completed_at = ? WHERE id IN (?, ?)").bind(message, nowIso(), `${workflowId}:worker`, `${workflowId}:manager`),
      db.prepare("UPDATE jobs SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?").bind(message, nowIso(), workflowId),
    ]);
    throw error;
  }
}

type Evidence = {
  title: string;
  url: string;
  publishedAt: string;
  source?: string;
};

type ProbabilityOutput = {
  estimated_probability: number;
  confidence: number;
  confidence_interval_low: number;
  confidence_interval_high: number;
  evidence: Evidence[];
  reasoning_summary: string;
  uncertainties: string[];
  provider: "deterministic" | "openai";
};

async function probabilityForContract(contract: Row, yesPrice: number, settings: Settings, evidence: Evidence[]): Promise<ProbabilityOutput> {
  if (settings.llmProvider === "openai") {
    return runOpenAIAnalysis(contract, yesPrice, settings, evidence);
  }
  const probability = Math.min(0.92, Math.max(0.08, demoProbabilityForMarket(String(contract.market_group)) || yesPrice + 0.04));
  return {
    estimated_probability: probability,
    confidence: 0.66,
    confidence_interval_low: Math.max(0, probability - 0.18),
    confidence_interval_high: Math.min(1, probability + 0.18),
    evidence,
    reasoning_summary: "Deterministic baseline: starts with the current market-implied probability and applies a small configured scenario adjustment. It is an estimate for research, not a statement of fact or investment advice.",
    uncertainties: evidence.some((item) => item.source?.startsWith("RSS "))
      ? ["RSS items are contextual evidence, not verified forecasts.", "The contract's resolution source and account permissions must be confirmed before any live action."]
      : ["No configured matching RSS item was available for this run.", "The contract's resolution source and account permissions must be confirmed before any live action."],
    provider: "deterministic",
  };
}

async function runOpenAIAnalysis(contract: Row, yesPrice: number, settings: Settings, evidence: Evidence[]): Promise<ProbabilityOutput> {
  const apiKey = await envString("OPENAI_API_KEY");
  if (!apiKey) throw new ApiError("OpenAI analysis is selected, but OPENAI_API_KEY is not configured.", 503, "llm_not_configured");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.llmModel,
      input: [
        {
          role: "system",
          content: [{
            type: "input_text",
            text: "Produce a cautious structured probability estimate for research only. Never recommend or submit an order. Separate estimates from facts. Use only the supplied contract information and return valid JSON.",
          }],
        },
        {
          role: "user",
          content: [{
            type: "input_text",
            text: JSON.stringify({
              question: contract.question,
              provider: contract.provider,
              exchange: contract.exchange,
              expiration: contract.expiration,
              resolution_criteria: contract.resolution_criteria,
              current_yes_price: yesPrice,
              supplied_evidence: evidence,
            }),
          }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "event_contract_probability",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              estimated_probability: { type: "number", minimum: 0, maximum: 1 },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              evidence: {
                type: "array",
                minItems: 1,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    url: { type: "string" },
                    published_at: { type: "string" },
                  },
                  required: ["title", "url", "published_at"],
                },
              },
              reasoning_summary: { type: "string" },
              uncertainties: { type: "array", items: { type: "string" } },
            },
            required: ["estimated_probability", "confidence", "evidence", "reasoning_summary", "uncertainties"],
          },
        },
      },
    }),
  });
  if (!response.ok) {
    if (response.status === 429) throw new ApiError("The configured analysis provider is rate limited. Try again later.", 429, "llm_rate_limited");
    throw new ApiError(`The configured analysis provider returned HTTP ${response.status}.`, 502, "llm_provider_error");
  }
  const body = (await response.json()) as Record<string, unknown>;
  const outputText = typeof body.output_text === "string" ? body.output_text : extractResponseText(body.output);
  if (!outputText) throw new ApiError("The analysis provider returned no structured output.", 502, "llm_malformed");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(outputText) as Record<string, unknown>;
  } catch {
    throw new ApiError("The analysis provider returned malformed JSON.", 502, "llm_malformed");
  }
  const probability = Number(parsed.estimated_probability);
  const confidence = Number(parsed.confidence);
  const intervalLow = Number(parsed.confidence_interval_low ?? Math.max(0, probability - (0.25 - confidence * 0.12)));
  const intervalHigh = Number(parsed.confidence_interval_high ?? Math.min(1, probability + (0.25 - confidence * 0.12)));
  const parsedEvidence = Array.isArray(parsed.evidence) ? parsed.evidence.map((item) => ({
    title: String((item as Row).title ?? ""),
    url: String((item as Row).url ?? ""),
    publishedAt: String((item as Row).published_at ?? ""),
  })) : [];
  if (!Number.isFinite(probability) || probability < 0 || probability > 1 || !Number.isFinite(confidence) || confidence < 0 || confidence > 1 || !Number.isFinite(intervalLow) || !Number.isFinite(intervalHigh) || intervalLow < 0 || intervalHigh > 1 || intervalLow > probability || intervalHigh < probability || parsedEvidence.length === 0 || parsedEvidence.some((item) => !item.title || !/^https:\/\//i.test(item.url) || !isFreshEvidence(item.publishedAt))) {
    throw new ApiError("The analysis provider returned an invalid probability or evidence payload.", 502, "llm_malformed");
  }
  return {
    estimated_probability: probability,
    confidence,
    confidence_interval_low: intervalLow,
    confidence_interval_high: intervalHigh,
    evidence: parsedEvidence,
    reasoning_summary: String(parsed.reasoning_summary ?? ""),
    uncertainties: Array.isArray(parsed.uncertainties) ? parsed.uncertainties.map(String) : [],
    provider: "openai",
  };
}

function extractResponseText(output: unknown): string | null {
  if (!Array.isArray(output)) return null;
  const textParts: string[] = [];
  for (const item of output) {
    const content = (item as Row)?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (typeof (part as Row)?.text === "string") textParts.push(String((part as Row).text));
    }
  }
  return textParts.join("").trim() || null;
}

export async function runResearch(contractId: string, viewer: Viewer) {
  const db = await requireDb();
  await ensureDemoData();
  const contract = await getContract(contractId);
  if (!contract) throw new ApiError("Contract not found", 404, "contract_not_found");
  if (!String(contract.resolution_criteria ?? "").trim()) throw new ApiError("The contract has no usable resolution criteria.", 409, "resolution_criteria_missing");
  const settings = await getSettings();
  const markets = await getMarkets();
  const market = markets.find((item) => item.id === String(contract.market_group));
  if (!market?.yes || !market.no) throw new ApiError("Both YES and NO quotes are required for research.", 409, "incomplete_market");
  const yesPrice = market.yes.price;
  if (yesPrice == null) throw new ApiError("A current YES quote is unavailable.", 409, "quote_unavailable");
  const baseEvidence: Evidence[] = [
    {
      title: "IBKR event contracts documentation",
      url: "https://www.interactivebrokers.com/campus/ibkr-api-page/event-contracts/",
      publishedAt: nowIso(),
      source: "IBKR reference",
    },
    {
      title: "IBKR event trading methods",
      url: "https://www.interactivebrokers.com/campus/ibkr-api-page/event-trading/",
      publishedAt: nowIso(),
      source: "IBKR reference",
    },
  ];
  const configuredNews = await collectResearchEvidence(db, settings.newsRssUrls, String(contract.question), settings.researchRefreshMinutes);
  const estimate = await probabilityForContract(contract, yesPrice, settings, [...baseEvidence, ...configuredNews]);
  const costsForYes = estimateCosts({ quote: market.yes.ask ?? yesPrice, maxSlippagePercent: settings.maxSlippagePercent, confidence: estimate.confidence });
  const costsForNo = estimateCosts({ quote: market.no.ask ?? market.no.price ?? 1 - yesPrice, maxSlippagePercent: settings.maxSlippagePercent, confidence: estimate.confidence });
  const yesEdge = calculateEdge({ estimatedProbability: estimate.estimated_probability, quote: market.yes.ask ?? yesPrice, side: "YES", ...costsForYes });
  const noEdge = calculateEdge({ estimatedProbability: estimate.estimated_probability, quote: market.no.ask ?? market.no.price ?? 1 - yesPrice, side: "NO", ...costsForNo });
  const selected = yesEdge.netEdge >= noEdge.netEdge ? { side: "YES", quote: market.yes.ask ?? yesPrice, edge: yesEdge, sideData: market.yes, costs: costsForYes } : { side: "NO", quote: market.no.ask ?? market.no.price ?? 1 - yesPrice, edge: noEdge, sideData: market.no, costs: costsForNo };
  const portfolio = await getPortfolioSummary();
  const researchId = id("research");
  const estimateId = id("estimate");
  const proposalId = id("proposal");
  const now = nowIso();
  const resolutionReady = String(contract.resolution_status ?? "unclear") === "verified" && Boolean(String(contract.resolution_source_url ?? "").trim());
  const proposalEligible = resolutionReady && estimate.confidence >= settings.minConfidence && selected.edge.netEdge >= settings.minEdge && Boolean(selected.sideData.quoteFresh) && ["paper_only", "eligible"].includes(String(contract.status));
  const kellyFraction = fractionalKelly({ probability: selected.edge.sideProbability, price: selected.quote, fraction: 0.25, maxFraction: 0.02 });
  const kellyQuantity = Math.floor((settings.startingCapitalUsd * kellyFraction) / Math.max(0.01, selected.quote));
  const quantity = Math.min(20, Math.max(1, Math.min(kellyQuantity || 1, Math.floor(settings.maxOrderSizeUsd / Math.max(0.01, selected.quote)))));
  const maxEntryPrice = roundToTick(Math.max(0, selected.edge.sideProbability - selected.costs.fee - selected.costs.slippage - selected.costs.uncertaintyPenalty), Number(contract.tick_size ?? 0.01));
  const finalRisk = riskChecks({
    quantity,
    price: selected.quote,
    currentExposure: Number((portfolio.positions as Row[]).find((row) => row.contract_id === selected.sideData.contractId)?.cost_basis ?? 0),
    totalExposure: Number(portfolio.costBasis ?? 0),
    dailyPnl: Number(portfolio.dailyPnl ?? 0),
    startingCapital: settings.startingCapitalUsd,
    openOrders: (await getOrderRows()).filter((row) => ["pending", "submitted", "partially_filled"].includes(String(row.status))).length,
    config: settings,
    killSwitch: settings.killSwitch,
  });
  const checksPass = proposalEligible && finalRisk.pass && quantity >= 1;
  const proposal = checksPass ? {
    id: proposalId,
    contractId: selected.sideData.contractId,
    outcome: selected.side,
    direction: "BUY",
    currentQuote: selected.quote,
    estimatedProbability: selected.edge.sideProbability,
    grossEdge: selected.edge.grossEdge,
    netEdge: selected.edge.netEdge,
    maxEntryPrice,
    quantity,
    notionalValue: Number((quantity * selected.quote).toFixed(2)),
    confidence: estimate.confidence,
    evidence: estimate.evidence,
    riskChecks: finalRisk.checks,
    status: "pending",
    expiresAt: new Date(Date.now() + settings.orderTimeoutSeconds * 1000).toISOString(),
    mode: settings.mode,
  } : null;

  const statements: D1PreparedStatement[] = [
    ...[
      ["research", { contractId, researchId }, `research:${researchId}`],
      ["news_refresh", { contractId, researchId, feedCount: settings.newsRssUrls ? settings.newsRssUrls.split(/[\n,]/g).filter(Boolean).length : 0 }, `news_refresh:${researchId}`],
      ["probability_analysis", { contractId, researchId, provider: estimate.provider }, `probability_analysis:${researchId}`],
      ["trade_proposal", { contractId, researchId, proposalCreated: Boolean(proposal) }, `trade_proposal:${researchId}`],
    ].map(([type, payload, idempotencyKey]) => db.prepare(
      `INSERT OR IGNORE INTO jobs
       (id, type, payload_json, status, attempt_count, idempotency_key, created_at, updated_at)
       VALUES (?, ?, ?, 'completed', 1, ?, ?, ?)`,
    ).bind(id("job"), type, JSON.stringify(payload), idempotencyKey, now, now)),
    db.prepare(
      `INSERT INTO research_runs
       (id, contract_id, status, provider, analyst_probability, confidence, reasoning_summary, uncertainties_json, evidence_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(researchId, contractId, "completed", estimate.provider, estimate.estimated_probability, estimate.confidence, estimate.reasoning_summary, JSON.stringify(estimate.uncertainties), JSON.stringify(estimate.evidence), now, now),
    db.prepare(
      `INSERT INTO probability_estimates
       (id, contract_id, research_run_id, estimated_probability, confidence, net_edge, source, assumptions_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(estimateId, contractId, researchId, estimate.estimated_probability, estimate.confidence, selected.edge.netEdge, estimate.provider, JSON.stringify(estimate.uncertainties), now),
    db.prepare(
      `INSERT INTO market_snapshots
       (id, contract_id, yes_bid, yes_ask, no_bid, no_ask, available_size, source, observed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id("market_snapshot"), contractId, market.yes.bid, market.yes.ask, market.no.bid, market.no.ask, Math.min(market.yes.askSize ?? 0, market.no.askSize ?? 0), contract.data_origin ?? "unknown", now),
    db.prepare(
      `INSERT INTO forecast_snapshots
       (id, contract_id, estimated_probability, confidence, market_probability, net_edge, agent_run_id, observed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id("forecast_snapshot"), contractId, estimate.estimated_probability, estimate.confidence, yesPrice, selected.edge.netEdge, null, now),
    db.prepare(
      `INSERT INTO audit_log (id, actor, action, entity_type, entity_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id("audit"), viewer.id, "research_run", "contract", contractId, JSON.stringify({ provider: estimate.provider, proposalCreated: Boolean(proposal) }), now),
  ];
  if (proposal) {
    statements.push(
      db.prepare(
        `INSERT INTO trade_proposals
         (id, contract_id, outcome, direction, current_quote, estimated_probability, gross_edge, net_edge,
          max_entry_price, quantity, notional_value, confidence, evidence_json, risk_check_results_json,
          status, expires_at, mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(proposal.id, proposal.contractId, proposal.outcome, proposal.direction, proposal.currentQuote, proposal.estimatedProbability, proposal.grossEdge, proposal.netEdge, proposal.maxEntryPrice, proposal.quantity, proposal.notionalValue, proposal.confidence, JSON.stringify(proposal.evidence), JSON.stringify(proposal.riskChecks), proposal.status, proposal.expiresAt, proposal.mode, now, now),
    );
    for (const evidence of proposal.evidence) {
      statements.push(
        db.prepare(
          `INSERT INTO proposal_evidence (id, proposal_id, title, url, published_at, source)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(id("evidence"), proposal.id, evidence.title, evidence.url, evidence.publishedAt, evidence.source ?? estimate.provider),
      );
    }
  }
  await db.batch(statements);
  return {
    contract: {
      id: String(contract.id),
      question: String(contract.question),
      outcome: String(contract.outcome),
      quote: selected.quote,
    },
    estimate,
    comparison: {
      yes: { quote: market.yes.price, impliedProbability: market.yes.price, netEdge: yesEdge.netEdge },
      no: { quote: market.no.price, impliedProbability: market.no.price, netEdge: noEdge.netEdge },
      selectedOutcome: selected.side,
      resolutionReady,
      opportunityRank: rankOpportunity({ netEdge: selected.edge.netEdge, confidence: estimate.confidence, marketQuality: market.quality?.score ?? 0, resolutionReady, quoteFresh: Boolean(selected.sideData.quoteFresh), liquidity: selected.sideData.askSize ?? 0, correlatedExposure: 0 }),
      positionSizing: { method: "quarter_kelly_capped", fraction: kellyFraction, quantity },
      marketQuality: market.quality ?? null,
      scenarios: [
        { name: "Bearish", probability: Math.max(0, selected.edge.sideProbability - 0.15), expectedPnl: Number((Math.max(0, selected.edge.sideProbability - 0.15) * quantity - selected.quote * quantity).toFixed(2)) },
        { name: "Base case", probability: selected.edge.sideProbability, expectedPnl: Number((selected.edge.sideProbability * quantity - selected.quote * quantity).toFixed(2)) },
        { name: "Bullish", probability: Math.min(1, selected.edge.sideProbability + 0.15), expectedPnl: Number((Math.min(1, selected.edge.sideProbability + 0.15) * quantity - selected.quote * quantity).toFixed(2)) },
      ],
    },
    riskChecks: finalRisk,
    proposal,
  };
}

export async function getResearch(contractId: string) {
  const db = await requireDb();
  await ensureDemoData();
  const contract = await getContract(contractId);
  if (!contract) throw new ApiError("Contract not found", 404, "contract_not_found");
  const research = await first<Row>(db, "SELECT * FROM research_runs WHERE contract_id = ? ORDER BY created_at DESC LIMIT 1", contractId);
  const estimate = research ? await first<Row>(db, "SELECT * FROM probability_estimates WHERE research_run_id = ? ORDER BY created_at DESC LIMIT 1", String(research.id)) : null;
  const evidence = research ? safeJson(research.evidence_json, []) : [];
  return {
    contract,
    research: research ? { ...research, uncertainties: safeJson(research.uncertainties_json, []), evidence } : null,
    estimate,
    evidence,
  };
}

export async function approveProposal(proposalId: string, viewer: Viewer) {
  const db = await requireDb();
  await ensureDemoData();
  const proposal = await first<Row>(db, "SELECT * FROM trade_proposals WHERE id = ?", proposalId);
  if (!proposal) throw new ApiError("Proposal not found", 404, "proposal_not_found");
  if (String(proposal.status) !== "pending") throw new ApiError(`Proposal is already ${String(proposal.status)}.`, 409, "proposal_not_pending");
  if (Date.parse(String(proposal.expires_at)) <= Date.now()) {
    await run(db, "UPDATE trade_proposals SET status = 'expired', updated_at = ? WHERE id = ?", nowIso(), proposalId);
    throw new ApiError("Proposal approval window has expired.", 409, "proposal_expired");
  }
  const settings = await getSettings();
  if (settings.killSwitch) throw new ApiError("Kill switch is active; approval is disabled.", 423, "kill_switch_active");
  const contract = await getContract(String(proposal.contract_id));
  if (!contract) throw new ApiError("Contract not found.", 404, "contract_not_found");
  if (!["paper_only", "eligible"].includes(String(contract.status))) throw new ApiError("The contract is not open for execution.", 409, "contract_not_open");
  const quoteRow = await first<Row>(db, "SELECT ask, observed_at, is_fresh FROM quotes WHERE contract_id = ? ORDER BY observed_at DESC LIMIT 1", String(contract.id));
  if (!quoteRow || !Boolean(quoteRow.is_fresh) || !freshQuote(String(quoteRow.observed_at ?? ""), 90)) throw new ApiError("The current quote is stale or unavailable.", 409, "quote_stale");
  const quote = Number(quoteRow.ask ?? contract.ask ?? contract.last_price ?? proposal.current_quote);
  if (!Number.isFinite(quote) || quote > Number(proposal.max_entry_price)) throw new ApiError("Current quote is above the proposal price ceiling.", 409, "price_ceiling");
  const portfolio = await getPortfolioSummary();
  const orderCount = (await getOrderRows()).filter((row) => ["pending", "submitted", "partially_filled"].includes(String(row.status))).length;
  const currentExposure = Number((portfolio.positions as Row[]).find((row) => row.contract_id === proposal.contract_id)?.cost_basis ?? 0);
  const checks = riskChecks({
    quantity: Number(proposal.quantity),
    price: quote,
    currentExposure,
    totalExposure: Number(portfolio.costBasis ?? 0),
    dailyPnl: Number(portfolio.dailyPnl ?? 0),
    startingCapital: settings.startingCapitalUsd,
    openOrders: orderCount,
    config: settings,
    killSwitch: settings.killSwitch,
  });
  if (!checks.pass) throw new ApiError("One or more risk checks failed at approval time.", 409, "risk_check_failed");
  if (settings.mode === "paper" && checks.notional > settings.paperCash) throw new ApiError("Available paper cash is below the order notional.", 409, "insufficient_funds");
  if (settings.mode === "live" && !settings.liveTradingEnabled) throw new ApiError("Live mode is not enabled by the server safety gate.", 423, "live_disabled");
  const mode = settings.mode;
  const routeThroughIbkr = settings.mode === "live" || (settings.mode === "paper" && settings.paperExecutionTarget === "ibkr");
  if (routeThroughIbkr && !settings.bridgeConfigured) throw new ApiError("IBKR paper routing is selected, but the Site bridge token is not configured.", 423, "bridge_not_configured");
  const brokerAdapter: BrokerAdapter = routeThroughIbkr ? new IBKRBridgeAdapter(mode) : new PaperBrokerAdapter();
  const submission = brokerAdapter.createSubmission({
    orderId: id("order-intent"),
    proposalId,
    contract,
    order: { action: "BUY", quantity: Number(proposal.quantity), limit_price: quote, order_type: "LMT", tif: "DAY" },
    approvalExpiresAt: String(proposal.expires_at),
    idempotencyKey: `proposal:${proposalId}`,
    maxEntryPrice: Number(proposal.max_entry_price),
    riskSnapshot: { currentExposure, totalExposure: Number(portfolio.costBasis ?? 0), dailyPnl: Number(portfolio.dailyPnl ?? 0) },
  });
  const now = nowIso();
  const orderId = id("order");
  const idempotencyKey = `proposal:${proposalId}`;
  const existing = await first<Row>(db, "SELECT * FROM orders WHERE idempotency_key = ?", idempotencyKey);
  if (existing) return { order: existing, mode: String(existing.mode), duplicate: true };

  if (routeThroughIbkr) {
    const jobId = id("job");
    const statements: D1PreparedStatement[] = [
      db.prepare(
        `INSERT INTO orders
         (id, proposal_id, contract_id, action, quantity, limit_price, tif, status, mode, idempotency_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(orderId, proposalId, proposal.contract_id, "BUY", proposal.quantity, quote, "DAY", "pending", mode, idempotencyKey, now, now),
      db.prepare("UPDATE trade_proposals SET status = 'approved', approved_at = ?, updated_at = ? WHERE id = ?").bind(now, now, proposalId),
      db.prepare(
        `INSERT INTO jobs (id, type, payload_json, status, attempt_count, idempotency_key, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)`,
      ).bind(jobId, "bridge_command", JSON.stringify({
        command: submission.command,
        order_id: orderId,
        proposal_id: proposalId,
        approved: true,
        approval_expires_at: proposal.expires_at,
        idempotency_key: idempotencyKey,
        max_entry_price: Number(proposal.max_entry_price),
        risk_snapshot: {
          current_exposure: currentExposure,
          total_exposure: Number(portfolio.costBasis ?? 0),
          daily_pnl: Number(portfolio.dailyPnl ?? 0),
          starting_capital: settings.startingCapitalUsd,
          open_orders: orderCount,
        },
        contract: {
          conid: contract.ibkr_conid,
          symbol: contract.symbol,
          sec_type: contract.sec_type,
          exchange: contract.exchange,
          currency: contract.currency,
          expiry: contract.expiration,
          strike: contract.strike,
          outcome: contract.outcome,
          trading_class: contract.trading_class,
          local_symbol: contract.local_symbol,
        },
        order: {
          action: "BUY",
          quantity: Number(proposal.quantity),
          limit_price: quote,
          order_type: "LMT",
          tif: "DAY",
        },
      }), `place_order:${orderId}`, now, now),
      db.prepare(
        `INSERT INTO audit_log (id, actor, action, entity_type, entity_id, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id("audit"), viewer.id, "proposal_approved", "trade_proposal", proposalId, JSON.stringify({ mode, route: "ibkr_tws_api", orderId }), now),
      db.prepare(`INSERT INTO decision_attributions (id, proposal_id, order_id, arrival_price, approval_price, submission_price, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id("attribution"), proposalId, orderId, proposal.current_quote, quote, quote, JSON.stringify({ mode, route: "ibkr_tws_api", actor: viewer.id }), now),
    ];
    await db.batch(statements);
    return { order: { id: orderId, status: "pending", mode }, mode, route: "ibkr_tws_api", duplicate: false };
  }

  const oldPosition = await first<Row>(db, "SELECT * FROM positions WHERE contract_id = ?", String(proposal.contract_id));
  const oldQuantity = Number(oldPosition?.quantity ?? 0);
  const oldCost = Number(oldPosition?.cost_basis ?? 0);
  const quantity = Number(proposal.quantity);
  const notional = Number((quantity * quote).toFixed(8));
  const newQuantity = oldQuantity + quantity;
  const newCost = oldCost + notional;
  const newAverage = newQuantity ? newCost / newQuantity : 0;
  const mark = Number(contract.last_price ?? quote);
  const newUnrealised = newQuantity * mark - newCost;
  const newCash = Number((settings.paperCash - notional).toFixed(8));
  if (newCash < settings.startingCapitalUsd * settings.minAccountFloorPercent / 100) throw new ApiError("Paper order would breach the account floor.", 409, "account_floor");
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO orders
       (id, proposal_id, contract_id, action, quantity, limit_price, tif, status, mode, idempotency_key, submitted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(orderId, proposalId, proposal.contract_id, "BUY", quantity, quote, "DAY", "filled", "paper", idempotencyKey, now, now, now),
    db.prepare(
      `INSERT INTO fills (id, order_id, broker_fill_id, quantity, price, commission, filled_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id("fill"), orderId, `paper-fill:${orderId}`, quantity, quote, 0, now, now),
    db.prepare(
      `INSERT INTO positions
       (id, contract_id, provider, outcome, quantity, average_entry_price, mark_price, cost_basis, unrealised_pnl, realised_pnl, status, mode, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 'paper', ?)
       ON CONFLICT(contract_id) DO UPDATE SET quantity = excluded.quantity,
         average_entry_price = excluded.average_entry_price, mark_price = excluded.mark_price,
         cost_basis = excluded.cost_basis, unrealised_pnl = excluded.unrealised_pnl,
         status = 'open', mode = excluded.mode, updated_at = excluded.updated_at`,
    ).bind(`position-${proposal.contract_id}`, proposal.contract_id, contract.provider, proposal.outcome, newQuantity, newAverage, mark, newCost, newUnrealised, Number(oldPosition?.realised_pnl ?? 0), now),
    db.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES ('paperCash', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    ).bind(JSON.stringify(newCash), now),
    db.prepare("UPDATE trade_proposals SET status = 'approved', approved_at = ?, updated_at = ? WHERE id = ?").bind(now, now, proposalId),
    db.prepare(
      `INSERT INTO portfolio_snapshots (id, cash, portfolio_value, daily_pnl, drawdown, total_return, mode, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'paper', ?)`,
    ).bind(id("snapshot"), newCash, newCash + newQuantity * mark, newCash + newQuantity * mark - settings.startingCapitalUsd, Math.min(0, newCash + newQuantity * mark - settings.startingCapitalUsd), newCash + newQuantity * mark - settings.startingCapitalUsd, now),
      db.prepare(
        `INSERT INTO audit_log (id, actor, action, entity_type, entity_id, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id("audit"), viewer.id, "proposal_approved", "trade_proposal", proposalId, JSON.stringify({ mode: "paper", orderId, quantity, quote }), now),
      db.prepare(`INSERT INTO decision_attributions (id, proposal_id, order_id, arrival_price, approval_price, submission_price, fill_price, realized_edge, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id("attribution"), proposalId, orderId, proposal.current_quote, quote, quote, quote, Number(proposal.estimated_probability) - quote, JSON.stringify({ mode: "paper", simulated: true }), now),
  ];
  await db.batch(statements);
  return { order: { id: orderId, status: "filled", mode: "paper", quantity, price: quote }, mode: "paper", duplicate: false };
}

export async function updateProposalStatus(proposalId: string, nextStatus: "rejected" | "cancelled", viewer: Viewer) {
  const db = await requireDb();
  const proposal = await first<Row>(db, "SELECT * FROM trade_proposals WHERE id = ?", proposalId);
  if (!proposal) throw new ApiError("Proposal not found", 404, "proposal_not_found");
  if (String(proposal.status) !== "pending") throw new ApiError(`Proposal is already ${String(proposal.status)}.`, 409, "proposal_not_pending");
  const now = nowIso();
  await db.batch([
    db.prepare("UPDATE trade_proposals SET status = ?, rejected_at = CASE WHEN ? = 'rejected' THEN ? ELSE rejected_at END, updated_at = ? WHERE id = ?").bind(nextStatus, nextStatus, now, now, proposalId),
    db.prepare(
      `INSERT INTO audit_log (id, actor, action, entity_type, entity_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id("audit"), viewer.id, `proposal_${nextStatus}`, "trade_proposal", proposalId, "{}", now),
  ]);
  return { id: proposalId, status: nextStatus };
}

export async function resetPaperPortfolio(startingBalance: number, viewer: Viewer) {
  const db = await requireDb();
  await ensureDemoData();
  const balance = Number.isFinite(startingBalance) && startingBalance > 0 ? startingBalance : 1000;
  const now = nowIso();
  await db.batch([
    db.prepare("DELETE FROM fills WHERE order_id IN (SELECT id FROM orders WHERE mode = 'paper')"),
    db.prepare("DELETE FROM orders WHERE mode = 'paper'"),
    db.prepare("DELETE FROM positions WHERE mode = 'paper'"),
    db.prepare("DELETE FROM portfolio_snapshots WHERE mode = 'paper'"),
    // A reset starts a clean paper workspace. Keep the audit log entry below,
    // but remove proposal/evidence rows so failed and expired attempts do not
    // clutter the active UI or get replayed accidentally.
    db.prepare("DELETE FROM proposal_evidence WHERE proposal_id IN (SELECT id FROM trade_proposals WHERE mode = 'paper')"),
    db.prepare("DELETE FROM trade_proposals WHERE mode = 'paper'"),
    db.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES ('startingCapitalUsd', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    ).bind(JSON.stringify(balance), now),
    db.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES ('paperCash', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    ).bind(JSON.stringify(balance), now),
    db.prepare(
      `INSERT INTO portfolio_snapshots (id, cash, portfolio_value, daily_pnl, drawdown, total_return, mode, created_at)
       VALUES (?, ?, ?, 0, 0, 0, 'paper', ?)`,
    ).bind(id("snapshot"), balance, balance, now),
    db.prepare(
      `INSERT INTO audit_log (id, actor, action, entity_type, entity_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id("audit"), viewer.id, "paper_portfolio_reset", "portfolio", "paper", JSON.stringify({ startingBalance: balance }), now),
  ]);
  return { ok: true, startingBalance: balance };
}

export async function simulateResolution(contractId: string, outcome: "YES" | "NO", viewer: Viewer) {
  const db = await requireDb();
  await ensureDemoData();
  const position = await first<Row>(db, "SELECT * FROM positions WHERE contract_id = ? AND mode = 'paper' AND status = 'open'", contractId);
  if (!position) throw new ApiError("Open position not found", 404, "position_not_found");
  const contract = await getContract(contractId);
  if (!contract) throw new ApiError("Contract not found", 404, "contract_not_found");
  const settings = await getSettings();
  const quantity = Number(position.quantity ?? 0);
  const costBasis = Number(position.cost_basis ?? 0);
  const payout = String(position.outcome).toUpperCase() === outcome ? quantity * Number(contract.settlement_value ?? 1) : 0;
  const realised = payout - costBasis;
  const cash = Number((settings.paperCash + payout).toFixed(8));
  const now = nowIso();
  await db.batch([
    db.prepare("UPDATE positions SET status = 'resolved', mark_price = ?, unrealised_pnl = 0, realised_pnl = ?, updated_at = ? WHERE id = ?").bind(Number(contract.settlement_value ?? 1), Number(position.realised_pnl ?? 0) + realised, now, position.id),
    db.prepare("UPDATE forecast_snapshots SET outcome = ?, resolved_at = ? WHERE contract_id = ? AND outcome IS NULL").bind(outcome === "YES" ? 1 : 0, now, contractId),
    db.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES ('paperCash', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    ).bind(JSON.stringify(cash), now),
    db.prepare(
      `INSERT INTO portfolio_snapshots (id, cash, portfolio_value, daily_pnl, drawdown, total_return, mode, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'paper', ?)`,
    ).bind(id("snapshot"), cash, cash, cash - settings.startingCapitalUsd, Math.min(0, cash - settings.startingCapitalUsd), cash - settings.startingCapitalUsd, now),
    db.prepare(
      `INSERT INTO audit_log (id, actor, action, entity_type, entity_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id("audit"), viewer.id, "paper_resolution_simulated", "position", String(position.id), JSON.stringify({ contractId, outcome, payout, realised }), now),
  ]);
  return { ok: true, contractId, outcome, payout, realisedPnl: realised };
}

export async function replayProposal(proposalId: string, viewer: Viewer) {
  const db = await requireDb();
  await ensureDemoData();
  const original = await first<Row>(db, "SELECT * FROM trade_proposals WHERE id = ?", proposalId);
  if (!original) throw new ApiError("Proposal not found", 404, "proposal_not_found");
  const settings = await getSettings();
  const newId = id("proposal");
  const now = nowIso();
  const expiresAt = new Date(Date.now() + settings.orderTimeoutSeconds * 1000).toISOString();
  await db.batch([
    db.prepare(
      `INSERT INTO trade_proposals
       (id, contract_id, outcome, direction, current_quote, estimated_probability, gross_edge, net_edge,
        max_entry_price, quantity, notional_value, confidence, evidence_json, risk_check_results_json,
        status, expires_at, mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 'paper', ?, ?)`,
    ).bind(newId, original.contract_id, original.outcome, original.direction, original.current_quote, original.estimated_probability, original.gross_edge, original.net_edge, original.max_entry_price, original.quantity, original.notional_value, original.confidence, original.evidence_json, original.risk_check_results_json, expiresAt, now, now),
    db.prepare(
      `INSERT INTO audit_log (id, actor, action, entity_type, entity_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id("audit"), viewer.id, "paper_proposal_replayed", "trade_proposal", newId, JSON.stringify({ sourceProposalId: proposalId }), now),
  ]);
  return { id: newId, status: "pending", sourceProposalId: proposalId };
}

export async function exportPaperHistory() {
  const rows = await getOrderRows();
  const header = ["order_id", "proposal_id", "question", "outcome", "action", "quantity", "limit_price", "status", "mode", "created_at"];
  const csv = [header, ...rows.filter((row) => String(row.mode) === "paper").map((row) => [
    row.id,
    row.proposal_id,
    row.question,
    row.outcome,
    row.action,
    row.quantity,
    row.limit_price,
    row.status,
    row.mode,
    row.created_at,
  ])].map((line) => line.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  return `${csv}\n`;
}

export async function setKillSwitch(active: boolean, reason: string, viewer: Viewer) {
  const db = await requireDb();
  await ensureDemoData();
  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES ('killSwitch', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    ).bind(JSON.stringify(active), now),
    db.prepare(
      `INSERT INTO risk_events (id, event_type, severity, message, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(id("risk"), active ? "kill_switch_activated" : "kill_switch_deactivated", active ? "high" : "info", reason || (active ? "Kill switch activated." : "Kill switch cleared."), JSON.stringify({ actor: viewer.id }), now),
    db.prepare(
      `INSERT INTO audit_log (id, actor, action, entity_type, entity_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id("audit"), viewer.id, active ? "kill_switch_on" : "kill_switch_off", "risk", "global", JSON.stringify({ reason }), now),
  ];
  if (active) {
    statements.push(
      db.prepare("UPDATE trade_proposals SET status = 'cancelled', updated_at = ? WHERE status = 'pending'").bind(now),
      db.prepare("UPDATE jobs SET status = 'cancelled', updated_at = ? WHERE type = 'bridge_command' AND status IN ('pending', 'claimed', 'processing')").bind(now),
      db.prepare(
        `INSERT INTO jobs (id, type, payload_json, status, attempt_count, idempotency_key, created_at, updated_at)
         VALUES (?, 'bridge_command', ?, 'pending', 0, ?, ?, ?)`,
      ).bind(id("job"), JSON.stringify({ command: "kill_switch", reason }), `kill_switch:${now}`, now, now),
    );
  }
  await db.batch(statements);
  return { active, reason };
}

export async function enqueueJob(type: string, payload: Record<string, unknown>, idempotencyKey: string) {
  const db = await requireDb();
  if (!DURABLE_JOB_TYPES.has(type)) throw new ApiError("Unsupported durable job type.", 400, "invalid_job_type");
  if (!idempotencyKey.trim()) throw new ApiError("A durable job idempotency key is required.", 400, "missing_idempotency_key");
  const existing = await first<Row>(db, "SELECT id FROM jobs WHERE idempotency_key = ?", idempotencyKey);
  if (existing) return String(existing.id);
  const now = nowIso();
  const jobId = id("job");
  await run(
    db,
    `INSERT OR IGNORE INTO jobs (id, type, payload_json, status, attempt_count, idempotency_key, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)`,
    jobId,
    type,
    JSON.stringify(payload),
    idempotencyKey,
    now,
    now,
  );
  return jobId;
}

export async function claimBridgeJobs(bridgeId: string, limit = 10): Promise<Row[]> {
  const db = await requireDb();
  const now = nowIso();
  const lease = new Date(Date.now() + 30_000).toISOString();
  const query = `UPDATE jobs
    SET status = 'claimed', attempt_count = attempt_count + 1, lease_expiry = ?, updated_at = ?
    WHERE id IN (
      SELECT id FROM jobs
      WHERE type IN ('bridge_command', 'reconciliation')
        AND (status = 'pending' OR (status = 'claimed' AND lease_expiry IS NOT NULL AND lease_expiry < ?))
      ORDER BY created_at ASC LIMIT ?
    )
    RETURNING id, type, payload_json, status, attempt_count, lease_expiry, error_message, idempotency_key, created_at, updated_at`;
  const rows = await all<Row>(db, query, lease, now, now, limit);
  return rows.map((row) => ({ ...row, payload: safeJson(row.payload_json, {}) }));
}

export async function completeBridgeJob(jobId: string, status: "completed" | "failed" | "expired" | "cancelled", errorMessage = "") {
  const db = await requireDb();
  await run(db, "UPDATE jobs SET status = ?, lease_expiry = NULL, error_message = ?, updated_at = ? WHERE id = ?", status, errorMessage || null, nowIso(), jobId);
}

async function hmac(secret: string, input: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

export async function verifyBridgeRequest(request: Request, rawBody = ""): Promise<{ bridgeId: string }> {
  const secret = await envString("IBKR_BRIDGE_TOKEN");
  if (!secret) throw new ApiError("Bridge authentication is not configured.", 503, "bridge_not_configured");
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const bridgeId = request.headers.get("x-bridge-id") ?? "";
  const timestamp = request.headers.get("x-bridge-timestamp") ?? "";
  const signature = request.headers.get("x-bridge-signature") ?? "";
  const timestampNumber = Number(timestamp);
  if (!bridgeId || !timestamp || !signature || !Number.isFinite(timestampNumber) || Math.abs(Date.now() - timestampNumber * 1000) > 5 * 60 * 1000 || !sameString(token, secret)) {
    throw new ApiError("Invalid bridge authentication.", 403, "bridge_auth_invalid");
  }
  const path = new URL(request.url).pathname;
  const expected = await hmac(secret, `${timestamp}.${request.method.toUpperCase()}.${path}.${rawBody}`);
  if (!sameString(signature, expected)) throw new ApiError("Invalid bridge signature.", 403, "bridge_signature_invalid");
  return { bridgeId };
}

export async function recordHeartbeat(input: Record<string, unknown>, bridgeId: string) {
  const db = await requireDb();
  const now = nowIso();
  const heartbeatMinute = now.slice(0, 16);
  await run(
    db,
    `INSERT INTO bridge_heartbeats
     (id, bridge_id, status, account_id, permissions_json, version, observed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id("heartbeat"),
    bridgeId,
    String(input.status ?? "unknown"),
    input.account_id ? String(input.account_id) : null,
    JSON.stringify(input.permissions ?? {}),
    input.version ? String(input.version) : null,
    now,
    now,
  );
  await run(
    db,
    `INSERT OR IGNORE INTO jobs
     (id, type, payload_json, status, attempt_count, idempotency_key, created_at, updated_at)
     VALUES (?, 'reconciliation', ?, 'pending', 0, ?, ?, ?)`,
    id("job"),
    JSON.stringify({ command: "reconcile", bridge_id: bridgeId, scheduled_by: "heartbeat" }),
    `reconciliation:${bridgeId}:${heartbeatMinute}`,
    now,
    now,
  );
  return { ok: true, observedAt: now, killSwitch: (await getSettings()).killSwitch };
}

export async function recordBridgeEvents(events: Array<Record<string, unknown>>, bridgeId: string) {
  const db = await requireDb();
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  for (const event of events.slice(0, 100)) {
    const kind = String(event.kind ?? "event");
    const orderId = event.order_id ? String(event.order_id) : null;
    if (kind === "contract_discovery") {
      const details = event.details && typeof event.details === "object" ? event.details as Row : {};
      const spec = event.spec && typeof event.spec === "object" ? event.spec as Row : {};
      const conid = Number(details.conid ?? spec.conid ?? 0);
      const outcome = String(event.outcome ?? spec.outcome ?? (String(details.right ?? "").toUpperCase() === "P" ? "NO" : "YES")).toUpperCase();
      if (Number.isFinite(conid) && conid > 0 && ["YES", "NO"].includes(outcome)) {
        const exchange = String(details.exchange ?? spec.exchange ?? "");
        const contractId = `ibkr-${conid}-${outcome.toLowerCase()}`;
        const permissionStatus = String(event.permission_status ?? (event.status === "permission_unavailable" ? "unavailable" : "available"));
        const expiration = String(details.real_expiration_date ?? details.last_trade_date_or_contract_month ?? spec.expiry ?? "");
        const isClosed = Number.isFinite(Date.parse(expiration)) && Date.parse(expiration) <= Date.now();
        const contractStatus = isClosed ? "closed" : permissionStatus === "available" ? "eligible" : "permission_unavailable";
        statements.push(
          db.prepare(
            `INSERT INTO contracts
             (id, market_group, ibkr_conid, provider, exchange, symbol, sec_type, trading_class,
              question, outcome, settlement_value, expiration, resolution_criteria, currency,
              tick_size, minimum_quantity, bid, ask, last_price, status, permission_status,
              eligible, strike, local_symbol, data_origin, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
              provider = excluded.provider, exchange = excluded.exchange, symbol = excluded.symbol,
              sec_type = excluded.sec_type, trading_class = excluded.trading_class,
              question = excluded.question, settlement_value = excluded.settlement_value,
              expiration = excluded.expiration, resolution_criteria = excluded.resolution_criteria,
              currency = excluded.currency, tick_size = excluded.tick_size,
              minimum_quantity = excluded.minimum_quantity, bid = excluded.bid, ask = excluded.ask,
              last_price = excluded.last_price, status = excluded.status,
              permission_status = excluded.permission_status, eligible = excluded.eligible,
              strike = excluded.strike, local_symbol = excluded.local_symbol,
              data_origin = excluded.data_origin, updated_at = excluded.updated_at`,
          ).bind(
            contractId,
            String(spec.market_group ?? `ibkr-${conid}`),
            conid,
            String(spec.provider ?? "Interactive Brokers"),
            exchange,
            String(details.symbol ?? spec.symbol ?? ""),
            String(details.sec_type ?? spec.sec_type ?? "OPT"),
            String(details.trading_class ?? spec.trading_class ?? ""),
            String(spec.question ?? details.long_name ?? details.market_name ?? `${details.symbol ?? "Event contract"} ${outcome}`),
            outcome,
            Number(spec.settlement_value ?? (exchange === "FORECASTX" ? 1 : 1)),
            expiration,
            String(spec.resolution_criteria ?? ""),
            String(details.currency ?? spec.currency ?? "USD"),
            Number(details.min_tick ?? spec.tick_size ?? 0.01),
            Number(spec.minimum_quantity ?? 1),
            event.quote && typeof event.quote === "object" ? Number((event.quote as Row).bid ?? 0) || null : null,
            event.quote && typeof event.quote === "object" ? Number((event.quote as Row).ask ?? 0) || null : null,
            event.quote && typeof event.quote === "object" ? Number((event.quote as Row).last ?? (event.quote as Row).last_price ?? 0) || null : null,
            contractStatus,
            permissionStatus,
            contractStatus === "eligible" ? 1 : 0,
            Number(details.strike ?? spec.strike ?? 0) || null,
            String(details.local_symbol ?? spec.local_symbol ?? ""),
            "bridge",
            now,
            now,
          ),
        );
        if (event.quote && typeof event.quote === "object") {
          const quote = event.quote as Row;
          const observedAt = String(quote.observed_at ?? now);
          const quoteId = id("quote");
          statements.push(
            db.prepare(
              `INSERT INTO quotes (id, contract_id, bid, ask, bid_size, ask_size, last_price, high_bid, buy_yes_now_at, is_fresh, observed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).bind(
              quoteId,
              contractId,
              Number(quote.bid ?? 0) || null,
              Number(quote.ask ?? 0) || null,
              Number(quote.bid_size ?? 0) || null,
              Number(quote.ask_size ?? 0) || null,
              Number(quote.last ?? quote.last_price ?? 0) || null,
              Number(quote.high ?? quote.high_bid ?? 0) || null,
              Number(quote.buy_yes_now_at ?? 0) || null,
              Number.isFinite(Date.parse(observedAt)) && Date.now() - Date.parse(observedAt) <= 90_000 ? 1 : 0,
              observedAt,
            ),
          );
        }
      }
    }
    if (kind === "stock_contract_discovery") {
      const stockContract = event.contract && typeof event.contract === "object" ? event.contract as Row : {};
      const ticker = String(stockContract.symbol ?? "").trim().toUpperCase();
      const details = event.details && typeof event.details === "object" ? event.details as Row : {};
      const conid = Number(details.conid ?? stockContract.conid ?? 0);
      if (ticker && Number.isFinite(conid) && conid > 0) {
        statements.push(db.prepare("UPDATE contracts SET ibkr_conid = ?, exchange = COALESCE(NULLIF(?, ''), exchange), trading_class = COALESCE(NULLIF(?, ''), trading_class), local_symbol = COALESCE(NULLIF(?, ''), local_symbol), data_origin = 'ibkr_bridge', updated_at = ? WHERE symbol = ? AND sec_type = 'STK'").bind(conid, String(stockContract.exchange ?? ""), String(stockContract.trading_class ?? ""), String(stockContract.local_symbol ?? ""), now, ticker));
      }
    }
    if (kind === "order_status" && orderId) {
      statements.push(
        db.prepare("UPDATE orders SET broker_order_id = COALESCE(?, broker_order_id), status = ?, reject_reason = ?, updated_at = ? WHERE id = ?").bind(event.broker_order_id ? String(event.broker_order_id) : null, String(event.status ?? "unknown"), event.reason ? String(event.reason) : null, now, orderId),
      );
    }
    if (kind === "fill" && orderId) {
      const fillId = String(event.fill_id ?? id("fill"));
      statements.push(
        db.prepare(
          `INSERT OR IGNORE INTO fills (id, order_id, broker_fill_id, quantity, price, commission, filled_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(fillId, orderId, event.broker_fill_id ? String(event.broker_fill_id) : null, Number(event.quantity ?? 0), Number(event.price ?? 0), Number(event.commission ?? 0), String(event.filled_at ?? now), now),
      );
      statements.push(db.prepare("UPDATE orders SET status = 'filled', updated_at = ? WHERE id = ?").bind(now, orderId));
    }
    if (kind === "job_status" && event.job_id) {
      const nextStatus = ["completed", "failed", "expired", "cancelled"].includes(String(event.status)) ? String(event.status) : "failed";
      statements.push(db.prepare("UPDATE jobs SET status = ?, lease_expiry = NULL, error_message = ?, updated_at = ? WHERE id = ?").bind(nextStatus, event.reason ? String(event.reason) : null, now, String(event.job_id)));
    }
    if (kind === "alpaca_snapshot" && event.snapshot && typeof event.snapshot === "object") {
      const snapshot = event.snapshot as Row;
      const observed = now;
      statements.push(
        db.prepare(`INSERT INTO app_settings (key, value_json, updated_at) VALUES ('alpacaSnapshot', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
          .bind("" + JSON.stringify({ ...redactObject(snapshot) as Row, observed_at: observed }), observed),
        db.prepare(`INSERT INTO audit_log (id, actor, action, entity_type, entity_id, payload_json, created_at)
          VALUES (?, ?, 'alpaca_snapshot_received', 'alpaca', ?, ?, ?)`)
          .bind(id("audit"), `bridge:${bridgeId}`, "snapshot", JSON.stringify({ status: snapshot.status, counts: { snapshots: Array.isArray(snapshot.snapshots) ? snapshot.snapshots.length : 0, news: Array.isArray(snapshot.news) ? snapshot.news.length : 0 } }), now),
      );
    }
    if (kind === "stock_snapshot" && event.snapshot && typeof event.snapshot === "object") {
      const snapshot = event.snapshot as Row;
      const ticker = String(snapshot.ticker ?? "").trim().toUpperCase();
      if (ticker) {
        statements.push(
          db.prepare(`INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
            .bind(`bridgeStockSnapshot:${ticker}`, JSON.stringify(redactObject(snapshot)), now),
          db.prepare(`INSERT INTO audit_log (id, actor, action, entity_type, entity_id, payload_json, created_at)
            VALUES (?, ?, 'stock_snapshot_received', 'research', ?, ?, ?)`)
            .bind(id("audit"), `bridge:${bridgeId}`, ticker, JSON.stringify({ source: snapshot.source, history_points: Array.isArray(snapshot.history) ? snapshot.history.length : 0 }), now),
        );
      }
    }
    if (kind === "reconciliation" && event.snapshot && typeof event.snapshot === "object") {
      const snapshot = event.snapshot as Row;
      const account = snapshot.account && typeof snapshot.account === "object" ? snapshot.account as Row : {};
      const positions = Array.isArray(snapshot.positions) ? snapshot.positions : [];
      const brokerMode = String(snapshot.mode ?? "paper") === "live" ? "live" : "paper";
      const openOrders = Array.isArray(snapshot.open_orders) ? snapshot.open_orders : [];
      for (const rawPosition of positions) {
        if (!rawPosition || typeof rawPosition !== "object") continue;
        const position = rawPosition as Row;
        const conid = Number(position.conid ?? 0);
        const outcome = String(position.outcome ?? "YES").toUpperCase();
        const isStock = String(position.sec_type ?? "").toUpperCase() === "STK";
        if ((!Number.isFinite(conid) || conid <= 0) && !isStock) continue;
        const contract = await first<Row>(db, "SELECT id, provider, outcome FROM contracts WHERE ibkr_conid = ? AND outcome = ? LIMIT 1", conid, outcome)
          ?? await first<Row>(db, "SELECT id, provider, outcome FROM contracts WHERE symbol = ? AND sec_type = 'STK' LIMIT 1", String(position.symbol ?? "").toUpperCase());
        if (!contract) continue;
        const quantity = Number(position.position ?? 0);
        const average = Number(position.avg_cost ?? 0);
        statements.push(
          db.prepare(
            `INSERT INTO positions (id, contract_id, provider, outcome, quantity, average_entry_price, mark_price, cost_basis, unrealised_pnl, realised_pnl, status, mode, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'open', ?, ?)
             ON CONFLICT(contract_id) DO UPDATE SET quantity = excluded.quantity,
              average_entry_price = excluded.average_entry_price, cost_basis = excluded.cost_basis,
              status = CASE WHEN excluded.quantity = 0 THEN 'closed' ELSE 'open' END, mode = excluded.mode, updated_at = excluded.updated_at`,
          ).bind(`${brokerMode}-position-${contract.id}`, contract.id, String(contract.provider), outcome, quantity, average, average, quantity * average, brokerMode, now),
        );
      }
      for (const rawOrder of openOrders) {
        if (!rawOrder || typeof rawOrder !== "object") continue;
        const openOrder = rawOrder as Row;
        if (openOrder.broker_order_id == null) continue;
        statements.push(
          db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE broker_order_id = ?").bind(String(openOrder.status ?? "submitted"), now, String(openOrder.broker_order_id)),
        );
      }
      const availableFunds = account.AvailableFunds && typeof account.AvailableFunds === "object" ? Number((account.AvailableFunds as Row).value ?? 0) : null;
      if (Number.isFinite(availableFunds)) {
        statements.push(
          db.prepare(
            `INSERT INTO portfolio_snapshots (id, cash, portfolio_value, daily_pnl, drawdown, total_return, mode, created_at)
             VALUES (?, ?, ?, 0, 0, 0, ?, ?)`,
          ).bind(id("snapshot"), availableFunds, availableFunds, brokerMode, now),
        );
      }
    }
    statements.push(
      db.prepare(
        `INSERT INTO audit_log (id, actor, action, entity_type, entity_id, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id("audit"), `bridge:${bridgeId}`, kind, "bridge_event", orderId, JSON.stringify(redactObject(event)), now),
    );
  }
  if (statements.length) await db.batch(statements);
  return { ok: true, recorded: events.length };
}

function redactObject(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactObject);
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/password|secret|token|private.?key|access.?token/i.test(key)) output[key] = "[REDACTED]";
    else output[key] = redactObject(item);
  }
  return output;
}

export async function readAppHealth() {
  const database = Boolean(await getD1());
  let databaseReady = false;
  if (database) {
    try {
      const db = await getD1();
      if (db) {
        await first(db, "SELECT 1 AS ok");
        databaseReady = true;
      }
    } catch {
      databaseReady = false;
    }
  }
  return { ok: databaseReady, databaseConfigured: database, databaseReady, mode: "paper", timestamp: nowIso() };
}
