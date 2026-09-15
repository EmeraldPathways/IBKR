import { ApiError, getD1, id, nowIso } from "./server";

export type StockSnapshot = {
  ticker: string;
  name: string;
  currency: string;
  price: number | null;
  changePercent: number | null;
  high52: number | null;
  low52: number | null;
  marketCap: number | null;
  marketCapUsd: number | null;
  sector: string | null;
  industry: string | null;
  pe: number | null;
  forwardPe: number | null;
  peg: number | null;
  eps: number | null;
  forwardEps: number | null;
  profitMargin: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  beta: number | null;
  debtEquity: number | null;
  dividendYield: number | null;
  analystBuy: number;
  analystHold: number;
  analystSell: number;
  meanTarget: number | null;
  history: Array<{ date: string; close: number }>;
  fetchedAt: string;
  source: string;
};

type JsonRecord = Record<string, unknown>;
function record(value: unknown): JsonRecord { return value && typeof value === "object" ? value as JsonRecord : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }

function parseJsonObject(text: string): JsonRecord | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const candidates = [cleaned];
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(cleaned.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as JsonRecord;
    } catch { /* Try the next extraction strategy. */ }
  }
  return null;
}

function responseTexts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(responseTexts);
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  return Object.values(row).flatMap(responseTexts);
}

const RESEARCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    context_catalysts: {
      type: "object", additionalProperties: false,
      properties: { summary: { type: "string" }, metrics: { type: "array", items: { type: "string" } }, uncertainties: { type: "array", items: { type: "string" } } },
      required: ["summary", "metrics", "uncertainties"],
    },
    valuation_growth: {
      type: "object", additionalProperties: false,
      properties: { summary: { type: "string" }, metrics: { type: "array", items: { type: "string" } }, uncertainties: { type: "array", items: { type: "string" } } },
      required: ["summary", "metrics", "uncertainties"],
    },
    competitors_risks: {
      type: "object", additionalProperties: false,
      properties: { summary: { type: "string" }, metrics: { type: "array", items: { type: "string" } }, uncertainties: { type: "array", items: { type: "string" } } },
      required: ["summary", "metrics", "uncertainties"],
    },
    competitor_tickers: { type: "array", items: { type: "string" } },
  },
  required: ["context_catalysts", "valuation_growth", "competitors_risks", "competitor_tickers"],
} as const;

function number(value: unknown): number | null {
  const candidate = typeof value === "object" && value !== null && "raw" in value ? (value as { raw?: unknown }).raw : value;
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

async function yahoo(path: string): Promise<unknown> {
  const response = await fetch(`https://query1.finance.yahoo.com${path}`, { headers: { Accept: "application/json", "User-Agent": "IBKR-Event-Contract-Workbench/1.0" } });
  if (!response.ok) throw new ApiError(`Yahoo Finance returned HTTP ${response.status}.`, response.status === 404 ? 404 : 502, "market_data_unavailable");
  return response.json();
}

async function usdRate(currency: string): Promise<number | null> {
  if (currency === "USD") return 1;
  try {
    const payload = await yahoo(`/v8/finance/chart/${encodeURIComponent(currency)}USD=X?range=1d&interval=1d`);
    const chart = chartResult(payload);
    return number(record(chart.meta).regularMarketPrice) ?? number(record(chart.meta).previousClose);
  } catch {
    return null;
  }
}

function chartResult(payload: unknown): JsonRecord {
  const chart = record(record(payload).chart);
  const result = record(array(chart.result)[0]);
  if (!result) throw new ApiError("Ticker not found or market data is unavailable.", 404, "ticker_not_found");
  return result;
}

export async function getStockSnapshot(input: string): Promise<StockSnapshot> {
  const ticker = input.trim().toUpperCase().replace(/[^A-Z0-9.^=-]/g, "");
  if (!ticker || ticker.length > 20) throw new ApiError("Enter a valid ticker symbol.", 400, "invalid_ticker");
  const [chartPayload, quotePayload] = await Promise.all([
    yahoo(`/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d&events=div%2Csplits`),
    yahoo(`/v7/finance/quote?symbols=${encodeURIComponent(ticker)}`).catch(() => null),
  ]);
  const chart = chartResult(chartPayload);
  const quoteResponse = record(record(quotePayload).quoteResponse);
  const quote = record(array(quoteResponse.result)[0]);
  const meta = record(chart.meta);
  const timestamps = array(chart.timestamp).filter((item): item is number => typeof item === "number");
  const indicators = record(chart.indicators);
  const quotes = record(array(indicators.quote)[0]);
  const closes = array(quotes.close).map((item) => typeof item === "number" ? item : null);
  const history = timestamps.map((timestamp, index) => ({ date: new Date(timestamp * 1000).toISOString().slice(0, 10), close: Number(closes[index]) })).filter((item) => Number.isFinite(item.close));
  if (!history.length && number(meta.regularMarketPrice) == null) throw new ApiError("Ticker not found or has no usable price history.", 404, "ticker_not_found");
  const price = number(quote?.regularMarketPrice) ?? number(meta.regularMarketPrice) ?? history.at(-1)?.close ?? null;
  const marketCap = number(quote?.marketCap);
  const exchange = String(quote?.currency ?? meta.currency ?? "USD").toUpperCase();
  const pe = number(quote?.trailingPE) ?? number(quote?.forwardPE);
  const forwardPe = number(quote?.forwardPE) ?? pe;
  const fx = await usdRate(exchange);
  const marketCapUsd = marketCap == null || fx == null ? null : marketCap * fx;
  return {
    ticker,
    name: String(quote?.longName ?? quote?.shortName ?? meta.longName ?? ticker),
    currency: exchange,
    price,
    changePercent: number(quote?.regularMarketChangePercent) ?? (number(meta.chartPreviousClose) && price != null ? (price / Number(meta.chartPreviousClose) - 1) * 100 : null),
    high52: number(quote?.fiftyTwoWeekHigh) ?? number(meta.fiftyTwoWeekHigh),
    low52: number(quote?.fiftyTwoWeekLow) ?? number(meta.fiftyTwoWeekLow),
    marketCap,
    marketCapUsd,
    sector: quote?.sector ?? null,
    industry: quote?.industry ?? null,
    pe,
    forwardPe,
    peg: number(quote?.pegRatio),
    eps: number(quote?.epsTrailingTwelveMonths) ?? (price != null && pe ? price / pe : null),
    forwardEps: number(quote?.epsForward) ?? (price != null && forwardPe ? price / forwardPe : null),
    profitMargin: number(quote?.profitMargins),
    revenueGrowth: number(quote?.revenueGrowth),
    earningsGrowth: number(quote?.earningsGrowth),
    beta: number(quote?.beta),
    debtEquity: number(quote?.debtToEquity),
    dividendYield: number(quote?.dividendYield),
    analystBuy: Number(quote?.analystRatingBuy ?? 0),
    analystHold: Number(quote?.analystRatingHold ?? 0),
    analystSell: Number(quote?.analystRatingSell ?? 0),
    meanTarget: number(quote?.targetMeanPrice),
    history,
    fetchedAt: nowIso(),
    source: "Yahoo Finance public market-data endpoint; yfinance-compatible schema",
  };
}

export async function saveResearchRun(ownerId: string, ticker: string, payload: unknown): Promise<void> {
  const db = await getD1();
  if (!db) return;
  const output = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  await db.prepare("INSERT INTO research_runs (id, contract_id, status, provider, reasoning_summary, uncertainties_json, evidence_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id("stock_research"), `stock:${ticker}`, "completed", "openai", String(output.context_catalysts ?? ""), JSON.stringify(output.uncertainties ?? []), JSON.stringify(output.evidence ?? []), nowIso(), nowIso()).run();
}

export async function researchWithModel(snapshot: StockSnapshot, ownerId: string): Promise<Record<string, unknown>> {
  const env = await import("cloudflare:workers").then((module) => module.env as Record<string, unknown>).catch(() => (typeof process !== "undefined" ? process.env as Record<string, unknown> : {}));
  const key = String(env.OPENAI_API_KEY ?? env.EMERGENT_LLM_KEY ?? "").trim();
  const base = String(env.OPENAI_BASE_URL ?? env.EMERGENT_LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = String(env.OPENAI_MODEL ?? env.EMERGENT_LLM_MODEL ?? "gpt-5-mini");
  if (!key) throw new ApiError("Deep Research AI is not configured. Add the existing Site-managed OPENAI_API_KEY secret.", 503, "llm_not_configured");
  const prompt = `Return only valid JSON with keys context_catalysts, valuation_growth, competitors_risks, competitor_tickers. Each section must contain summary, metrics, uncertainties. Use only the supplied market data. Do not invent facts, dates, figures, catalysts, competitors or risks. If a field is not present in the data, say it is unavailable and put that limitation in uncertainties. Label estimates and do not give personal financial advice. Preserve the source and fetchedAt boundary in your reasoning.\nMARKET DATA:\n${JSON.stringify(snapshot)}`;
  const response = await fetch(`${base}/responses`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, store: false, instructions: "You are a careful equity research analyst. Never invent facts. Return only the requested structured object. Never write prose outside the object.", input: prompt, max_output_tokens: 2200, reasoning: { effort: "low" }, text: { format: { type: "json_schema", name: "stock_research_brief", strict: true, schema: RESEARCH_SCHEMA } } }) });
  if (!response.ok) throw new ApiError(`Deep Research AI returned HTTP ${response.status}.`, 502, "llm_unavailable");
  const body = await response.json();
  const preferred = [record(body).output_text, ...array(record(body).output).flatMap(responseTexts)];
  const candidates = [...preferred, ...responseTexts(body)].filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean).filter((value, index, all) => all.indexOf(value) === index);
  const content = candidates[0] ?? "";
  const parsed = candidates.map(parseJsonObject).find(isCompleteResearchBrief);
  if (!parsed) {
    throw new ApiError("Deep Research AI returned text instead of the required structured JSON. Try again.", 502, "llm_malformed");
  }
  await saveResearchRun(ownerId, snapshot.ticker, parsed);
  return { ...parsed, model, generatedAt: nowIso() };
}

function isCompleteResearchBrief(value: JsonRecord | null): value is JsonRecord {
  if (!value) return false;
  const sections = ["context_catalysts", "valuation_growth", "competitors_risks"];
  if (!sections.every((key) => {
    const section = record(value[key]);
    return typeof section.summary === "string" && Array.isArray(section.metrics) && Array.isArray(section.uncertainties);
  })) return false;
  return Array.isArray(value.competitor_tickers) && value.competitor_tickers.every((item) => typeof item === "string");
}
