import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const contracts = sqliteTable(
  "contracts",
  {
    id: text("id").primaryKey(),
    marketGroup: text("market_group").notNull(),
    ibkrConid: integer("ibkr_conid"),
    provider: text("provider").notNull(),
    exchange: text("exchange").notNull(),
    symbol: text("symbol").notNull(),
    secType: text("sec_type").notNull(),
    tradingClass: text("trading_class"),
    question: text("question").notNull(),
    outcome: text("outcome").notNull(),
    settlementValue: real("settlement_value").notNull().default(1),
    expiration: text("expiration").notNull(),
    resolutionCriteria: text("resolution_criteria").notNull().default(""),
    resolutionSourceName: text("resolution_source_name"),
    resolutionSourceUrl: text("resolution_source_url"),
    measurementPeriod: text("measurement_period"),
    ambiguityScore: real("ambiguity_score").notNull().default(1),
    resolutionRuleHash: text("resolution_rule_hash"),
    resolutionStatus: text("resolution_status").notNull().default("unclear"),
    currency: text("currency").notNull().default("USD"),
    tickSize: real("tick_size").notNull().default(0.01),
    minimumQuantity: real("minimum_quantity").notNull().default(1),
    bid: real("bid"),
    ask: real("ask"),
    lastPrice: real("last_price"),
    status: text("status").notNull().default("paper_only"),
    permissionStatus: text("permission_status").notNull().default("unknown"),
    eligible: integer("eligible", { mode: "boolean" }).notNull().default(false),
    lastTradeAt: text("last_trade_at"),
    expectedResolutionAt: text("expected_resolution_at"),
    expectedPayoutAt: text("expected_payout_at"),
    measuredPeriod: text("measured_period"),
    strike: real("strike"),
    localSymbol: text("local_symbol"),
    dataOrigin: text("data_origin").notNull().default("ibkr_bridge"),
    rawJson: text("raw_json"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("contracts_market_group_idx").on(table.marketGroup),
    index("contracts_status_idx").on(table.status),
    uniqueIndex("contracts_ibkr_conid_outcome_idx").on(
      table.ibkrConid,
      table.outcome,
    ),
  ],
);

export const quotes = sqliteTable(
  "quotes",
  {
    id: text("id").primaryKey(),
    contractId: text("contract_id").notNull(),
    bid: real("bid"),
    ask: real("ask"),
    bidSize: real("bid_size"),
    askSize: real("ask_size"),
    lastPrice: real("last_price"),
    highBid: real("high_bid"),
    buyYesNowAt: real("buy_yes_now_at"),
    isFresh: integer("is_fresh", { mode: "boolean" }).notNull().default(true),
    observedAt: text("observed_at").notNull(),
  },
  (table) => [
    index("quotes_contract_observed_idx").on(table.contractId, table.observedAt),
  ],
);

export const newsItems = sqliteTable(
  "news_items",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    source: text("source").notNull(),
    publishedAt: text("published_at").notNull(),
    contentHash: text("content_hash").notNull(),
    summary: text("summary").notNull().default(""),
    rawJson: text("raw_json"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("news_items_hash_idx").on(table.contentHash)],
);

export const researchRuns = sqliteTable(
  "research_runs",
  {
    id: text("id").primaryKey(),
    contractId: text("contract_id").notNull(),
    status: text("status").notNull().default("completed"),
    provider: text("provider").notNull().default("deterministic"),
    analystProbability: real("analyst_probability"),
    confidence: real("confidence"),
    reasoningSummary: text("reasoning_summary").notNull().default(""),
    uncertaintiesJson: text("uncertainties_json").notNull().default("[]"),
    evidenceJson: text("evidence_json").notNull().default("[]"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("research_runs_contract_created_idx").on(
      table.contractId,
      table.createdAt,
    ),
  ],
);

export const probabilityEstimates = sqliteTable(
  "probability_estimates",
  {
    id: text("id").primaryKey(),
    contractId: text("contract_id").notNull(),
    researchRunId: text("research_run_id").notNull(),
    estimatedProbability: real("estimated_probability").notNull(),
    confidence: real("confidence").notNull(),
    netEdge: real("net_edge"),
    source: text("source").notNull(),
    assumptionsJson: text("assumptions_json").notNull().default("[]"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("probability_estimates_contract_created_idx").on(
      table.contractId,
      table.createdAt,
    ),
  ],
);

export const tradeProposals = sqliteTable(
  "trade_proposals",
  {
    id: text("id").primaryKey(),
    contractId: text("contract_id").notNull(),
    outcome: text("outcome").notNull(),
    direction: text("direction").notNull(),
    currentQuote: real("current_quote").notNull(),
    estimatedProbability: real("estimated_probability").notNull(),
    grossEdge: real("gross_edge").notNull(),
    netEdge: real("net_edge").notNull(),
    maxEntryPrice: real("max_entry_price").notNull(),
    quantity: real("quantity").notNull(),
    notionalValue: real("notional_value").notNull(),
    confidence: real("confidence").notNull(),
    evidenceJson: text("evidence_json").notNull().default("[]"),
    riskCheckResultsJson: text("risk_check_results_json").notNull().default("[]"),
    status: text("status").notNull().default("pending"),
    expiresAt: text("expires_at").notNull(),
    mode: text("mode").notNull().default("paper"),
    approvedAt: text("approved_at"),
    rejectedAt: text("rejected_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("trade_proposals_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
  ],
);

export const proposalEvidence = sqliteTable("proposal_evidence", {
  id: text("id").primaryKey(),
  proposalId: text("proposal_id").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  publishedAt: text("published_at").notNull(),
  source: text("source").notNull().default("official"),
});

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    proposalId: text("proposal_id"),
    contractId: text("contract_id").notNull(),
    brokerOrderId: text("broker_order_id"),
    action: text("action").notNull(),
    quantity: real("quantity").notNull(),
    limitPrice: real("limit_price").notNull(),
    tif: text("tif").notNull().default("DAY"),
    status: text("status").notNull().default("pending"),
    mode: text("mode").notNull().default("paper"),
    idempotencyKey: text("idempotency_key").notNull(),
    rejectReason: text("reject_reason"),
    submittedAt: text("submitted_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("orders_idempotency_idx").on(table.idempotencyKey),
    index("orders_status_idx").on(table.status),
  ],
);

export const fills = sqliteTable(
  "fills",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    brokerFillId: text("broker_fill_id"),
    quantity: real("quantity").notNull(),
    price: real("price").notNull(),
    commission: real("commission").notNull().default(0),
    filledAt: text("filled_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("fills_broker_fill_idx").on(table.brokerFillId)],
);

export const positions = sqliteTable(
  "positions",
  {
    id: text("id").primaryKey(),
    contractId: text("contract_id").notNull(),
    provider: text("provider").notNull(),
    outcome: text("outcome").notNull(),
    quantity: real("quantity").notNull().default(0),
    averageEntryPrice: real("average_entry_price").notNull().default(0),
    markPrice: real("mark_price").notNull().default(0),
    costBasis: real("cost_basis").notNull().default(0),
    unrealisedPnl: real("unrealised_pnl").notNull().default(0),
    realisedPnl: real("realised_pnl").notNull().default(0),
    status: text("status").notNull().default("open"),
    mode: text("mode").notNull().default("paper"),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("positions_contract_idx").on(table.contractId),
    index("positions_status_idx").on(table.status),
  ],
);

export const portfolioSnapshots = sqliteTable(
  "portfolio_snapshots",
  {
    id: text("id").primaryKey(),
    cash: real("cash").notNull(),
    portfolioValue: real("portfolio_value").notNull(),
    dailyPnl: real("daily_pnl").notNull(),
    drawdown: real("drawdown").notNull(),
    totalReturn: real("total_return").notNull(),
    mode: text("mode").notNull().default("paper"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("portfolio_snapshots_created_idx").on(table.createdAt)],
);

export const riskEvents = sqliteTable(
  "risk_events",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    severity: text("severity").notNull(),
    message: text("message").notNull(),
    detailsJson: text("details_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("risk_events_created_idx").on(table.createdAt)],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    leaseExpiry: text("lease_expiry"),
    errorMessage: text("error_message"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("jobs_idempotency_idx").on(table.idempotencyKey),
    index("jobs_claim_idx").on(table.status, table.type, table.createdAt),
  ],
);

export const bridgeHeartbeats = sqliteTable(
  "bridge_heartbeats",
  {
    id: text("id").primaryKey(),
    bridgeId: text("bridge_id").notNull(),
    status: text("status").notNull(),
    accountId: text("account_id"),
    permissionsJson: text("permissions_json").notNull().default("{}"),
    version: text("version"),
    observedAt: text("observed_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("bridge_heartbeats_observed_idx").on(table.bridgeId, table.observedAt)],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    payloadJson: text("payload_json").notNull().default("{}"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("audit_log_created_idx").on(table.createdAt)],
);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const dataSources = sqliteTable("data_sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  endpoint: text("endpoint"),
  reliability: real("reliability").notNull().default(0.5),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastSuccessAt: text("last_success_at"),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const ingestionRuns = sqliteTable("ingestion_runs", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull(),
  status: text("status").notNull().default("running"),
  recordsFetched: integer("records_fetched").notNull().default(0),
  recordsAccepted: integer("records_accepted").notNull().default(0),
  recordsRejected: integer("records_rejected").notNull().default(0),
  errorMessage: text("error_message"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
});

export const marketSnapshots = sqliteTable("market_snapshots", {
  id: text("id").primaryKey(),
  contractId: text("contract_id").notNull(),
  yesBid: real("yes_bid"),
  yesAsk: real("yes_ask"),
  noBid: real("no_bid"),
  noAsk: real("no_ask"),
  availableSize: real("available_size"),
  source: text("source").notNull(),
  observedAt: text("observed_at").notNull(),
});

export const resolutionObservations = sqliteTable("resolution_observations", {
  id: text("id").primaryKey(),
  contractId: text("contract_id").notNull(),
  sourceId: text("source_id").notNull(),
  observationType: text("observation_type").notNull(),
  valueJson: text("value_json").notNull(),
  sourceUrl: text("source_url"),
  observedAt: text("observed_at").notNull(),
  confidence: real("confidence").notNull().default(0.5),
});

export const forecastSnapshots = sqliteTable("forecast_snapshots", {
  id: text("id").primaryKey(),
  contractId: text("contract_id").notNull(),
  estimatedProbability: real("estimated_probability").notNull(),
  confidence: real("confidence").notNull(),
  marketProbability: real("market_probability"),
  netEdge: real("net_edge"),
  agentRunId: text("agent_run_id"),
  outcome: integer("outcome"),
  resolvedAt: text("resolved_at"),
  observedAt: text("observed_at").notNull(),
});

export const dataQualityEvents = sqliteTable("data_quality_events", {
  id: text("id").primaryKey(),
  sourceId: text("source_id"),
  contractId: text("contract_id"),
  severity: text("severity").notNull(),
  eventType: text("event_type").notNull(),
  message: text("message").notNull(),
  detailsJson: text("details_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  role: text("role").notNull(),
  model: text("model").notNull(),
  taskType: text("task_type").notNull(),
  contractId: text("contract_id"),
  status: text("status").notNull().default("queued"),
  inputJson: text("input_json").notNull().default("{}"),
  outputJson: text("output_json"),
  errorMessage: text("error_message"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const agentTasks = sqliteTable("agent_tasks", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  taskType: text("task_type").notNull(),
  status: text("status").notNull().default("pending"),
  payloadJson: text("payload_json").notNull().default("{}"),
  resultJson: text("result_json"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const agentDecisions = sqliteTable("agent_decisions", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  decision: text("decision").notNull(),
  rationale: text("rationale").notNull(),
  evidenceJson: text("evidence_json").notNull().default("[]"),
  supportingEvidenceJson: text("supporting_evidence_json").notNull().default("[]"),
  contradictoryEvidenceJson: text("contradictory_evidence_json").notNull().default("[]"),
  whatWouldChange: text("what_would_change").notNull().default("New verified evidence or a material quote change."),
  strongestNoTradeReason: text("strongest_no_trade_reason").notNull().default("Insufficient verified evidence or failed risk/data gates."),
  requiresApproval: integer("requires_approval", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const helperMessages = sqliteTable("helper_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ownerId: text("owner_id").notNull(),
  role: text("role").notNull(),
  message: text("message").notNull(),
  model: text("model").notNull(),
  view: text("view"),
  program: text("program"),
  createdAt: text("created_at").notNull(),
}, (table) => ({ ownerCreatedIdx: index("helper_messages_owner_created_idx").on(table.ownerId, table.createdAt) }));
