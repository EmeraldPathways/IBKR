"use client";

import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Check,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Database,
  FileCheck2,
  FileText,
  Gauge,
  Info,
  Layers3,
  LineChart,
  LockKeyhole,
  MessageCircle,
  Menu,
  RefreshCw,
  Search,
  ScrollText,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Send,
  Trash2,
  Terminal,
  TrendingDown,
  TrendingUp,
  WalletCards,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Dynamic D1 rows are intentionally kept flexible at this UI boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = Record<string, any>;

type MarketSide = {
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
  strike: number | null;
};

type Market = {
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
  yes: MarketSide | null;
  no: MarketSide | null;
  resolutionStatus?: string;
  resolutionSourceName?: string | null;
  resolutionSourceUrl?: string | null;
  measurementPeriod?: string | null;
  ambiguityScore?: number;
  quality?: { score: number; components: Record<string, number> };
};

type AppSettings = {
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

type Portfolio = {
  simulated: boolean;
  cash: number;
  markValue: number;
  portfolioValue: number;
  costBasis: number;
  unrealisedPnl: number;
  realisedPnl: number;
  totalReturn: number;
  totalReturnPercent: number;
  dailyPnl: number;
  drawdown: number;
  positions: AnyRow[];
  resolvedPositions: AnyRow[];
  tradeHistory: AnyRow[];
  exposureByProvider: AnyRow[];
};

type Risk = {
  settings: AnyRow;
  availableBalance: number;
  aggregateExposure: number;
  dailyPnl: number;
  drawdown: number;
  accountFloor: number;
  openOrders: number;
  pendingProposals: number;
  exposureByContract: AnyRow[];
  concentration: number;
  slippageEstimate: number;
  breaches: Array<{ severity: string; message: string }>;
  tradingHalted: boolean;
  haltReason: string | null;
  killSwitch: boolean;
};

type Proposal = AnyRow;

type DashboardState = {
  mode: "paper" | "live";
  simulated: boolean;
  liveTradingEnabled: boolean;
  manualApprovalRequired: boolean;
  bridge: AnyRow;
  ibkr: AnyRow;
  risk: Risk;
  portfolio: Portfolio;
  proposals: Proposal[];
  openOrders: number;
  lastDataRefresh: string;
  killSwitch: boolean;
  settings: AppSettings;
  dataHealth: AnyRow;
  agents: AnyRow;
  forecastAnalytics: AnyRow;
  alpaca: AnyRow;
  decisionLayer: AnyRow;
  professionalAnalytics: AnyRow;
};

type ResearchResult = {
  contract: AnyRow;
  estimate: {
    estimated_probability: number;
    confidence: number;
    evidence: Array<{ title: string; url: string; publishedAt: string; source?: string }>;
    reasoning_summary: string;
    uncertainties: string[];
    provider: string;
  };
  comparison: AnyRow;
  riskChecks: AnyRow;
  proposal: Proposal | null;
};

type StockSnapshot = {
  ticker: string; name: string; currency: string; price: number | null; changePercent: number | null; high52: number | null; low52: number | null; marketCap: number | null; marketCapUsd: number | null; sector: string | null; industry: string | null; pe: number | null; forwardPe: number | null; peg: number | null; eps: number | null; forwardEps: number | null; profitMargin: number | null; revenueGrowth: number | null; earningsGrowth: number | null; beta: number | null; debtEquity: number | null; dividendYield: number | null; analystBuy: number; analystHold: number; analystSell: number; meanTarget: number | null; history: Array<{ date: string; close: number }>; fetchedAt: string; source: string;
};

const FALLBACK_MARKETS: Market[] = [
  {
    id: "ff-target-rate",
    question: "Will the US Fed Funds Target Rate be above 5.00% on 8 December 2026?",
    provider: "ForecastEx",
    exchange: "FORECASTX",
    expiration: "2026-12-08T19:00:00.000Z",
    resolutionCriteria: "Official rate publication under the contract rules.",
    currency: "USD",
    status: "paper_only",
    permissionStatus: "not_checked",
    eligible: false,
    dataOrigin: "demo",
    yes: { contractId: "demo-ff-target-rate-yes", conid: 900000001, outcome: "YES", bid: 0.57, ask: 0.59, bidSize: 120, askSize: 85, lastPrice: 0.58, price: 0.59, quoteObservedAt: new Date().toISOString(), quoteFresh: true, eligible: false, tickSize: 0.01, minimumQuantity: 1, strike: 5 },
    no: { contractId: "demo-ff-target-rate-no", conid: 900000002, outcome: "NO", bid: 0.41, ask: 0.43, bidSize: 95, askSize: 110, lastPrice: 0.42, price: 0.43, quoteObservedAt: new Date().toISOString(), quoteFresh: true, eligible: false, tickSize: 0.01, minimumQuantity: 1, strike: 5 },
  },
  {
    id: "us-cpi-print",
    question: "Will US CPI be above 3.00% for the October 2026 release?",
    provider: "ForecastEx",
    exchange: "FORECASTX",
    expiration: "2026-11-12T13:30:00.000Z",
    resolutionCriteria: "Relevant official US CPI release under the contract rules.",
    currency: "USD",
    status: "paper_only",
    permissionStatus: "not_checked",
    eligible: false,
    dataOrigin: "demo",
    yes: { contractId: "demo-us-cpi-print-yes", conid: 900000011, outcome: "YES", bid: 0.41, ask: 0.43, bidSize: 80, askSize: 90, lastPrice: 0.42, price: 0.43, quoteObservedAt: new Date().toISOString(), quoteFresh: true, eligible: false, tickSize: 0.01, minimumQuantity: 1, strike: 3 },
    no: { contractId: "demo-us-cpi-print-no", conid: 900000012, outcome: "NO", bid: 0.57, ask: 0.59, bidSize: 130, askSize: 75, lastPrice: 0.58, price: 0.59, quoteObservedAt: new Date().toISOString(), quoteFresh: true, eligible: false, tickSize: 0.01, minimumQuantity: 1, strike: 3 },
  },
  {
    id: "gold-settlement",
    question: "Will the CME gold futures event settle higher at the end of the session?",
    provider: "CME Group",
    exchange: "COMEX",
    expiration: "2026-09-30T20:00:00.000Z",
    resolutionCriteria: "Applicable CME futures settlement methodology.",
    currency: "USD",
    status: "paper_only",
    permissionStatus: "not_checked",
    eligible: false,
    dataOrigin: "demo",
    yes: { contractId: "demo-gold-settlement-yes", conid: 900000021, outcome: "YES", bid: 0.45, ask: 0.47, bidSize: 12, askSize: 18, lastPrice: 0.46, price: 0.47, quoteObservedAt: new Date().toISOString(), quoteFresh: true, eligible: false, tickSize: 0.01, minimumQuantity: 1, strike: 4000 },
    no: { contractId: "demo-gold-settlement-no", conid: 900000022, outcome: "NO", bid: 0.53, ask: 0.55, bidSize: 15, askSize: 14, lastPrice: 0.54, price: 0.55, quoteObservedAt: new Date().toISOString(), quoteFresh: true, eligible: false, tickSize: 0.01, minimumQuantity: 1, strike: 4000 },
  },
];

const FALLBACK_SETTINGS: AppSettings = {
  mode: "paper",
  paperExecutionTarget: "ibkr",
  manualApprovalRequired: true,
  allowMarketOrders: false,
  liveTradingEnabled: false,
  bridgeConfigured: false,
  watchlist: ["ff-target-rate"],
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
  paperCash: 1000,
};

const FALLBACK_PORTFOLIO: Portfolio = {
  simulated: true,
  cash: 1000,
  markValue: 0,
  portfolioValue: 1000,
  costBasis: 0,
  unrealisedPnl: 0,
  realisedPnl: 0,
  totalReturn: 0,
  totalReturnPercent: 0,
  dailyPnl: 0,
  drawdown: 0,
  positions: [],
  resolvedPositions: [],
  tradeHistory: [],
  exposureByProvider: [],
};

const FALLBACK_PROPOSAL: Proposal = {
  id: "proposal_demo_ff_target_rate",
  contract_id: "demo-ff-target-rate-yes",
  question: FALLBACK_MARKETS[0].question,
  provider: "ForecastEx",
  outcome: "YES",
  direction: "BUY",
  current_quote: 0.59,
  estimated_probability: 0.68,
  gross_edge: 0.09,
  net_edge: 0.0824,
  max_entry_price: 0.65,
  quantity: 20,
  notional_value: 11.8,
  confidence: 0.72,
  status: "pending",
  expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  mode: "paper",
  evidence: [],
  riskChecks: [],
};

const FALLBACK_RISK: Risk = {
  settings: {},
  availableBalance: 1000,
  aggregateExposure: 0,
  dailyPnl: 0,
  drawdown: 0,
  accountFloor: 200,
  openOrders: 0,
  pendingProposals: 1,
  exposureByContract: [],
  concentration: 0,
  slippageEstimate: 0.015,
  breaches: [],
  tradingHalted: false,
  haltReason: null,
  killSwitch: false,
};

const FALLBACK_STATE: DashboardState = {
  mode: "paper",
  simulated: true,
  liveTradingEnabled: false,
  manualApprovalRequired: true,
  bridge: { state: "unavailable", configured: false, lastHeartbeat: null },
  ibkr: { connection: "not connected", accountId: null, balance: null, eventContractsPermission: "not checked" },
  risk: FALLBACK_RISK,
  portfolio: FALLBACK_PORTFOLIO,
  proposals: [FALLBACK_PROPOSAL],
  openOrders: 0,
  lastDataRefresh: new Date().toISOString(),
  killSwitch: false,
  settings: FALLBACK_SETTINGS,
  dataHealth: { status: "awaiting_data", sources: [], marketSnapshots: 0, forecastSnapshots: 0, qualityEvents: [] },
  agents: {
    manager: { model: "5.6 Luna Max", responsibility: "Evidence review and proposal drafting" },
    worker: { model: "5.6 Luna Medium", responsibility: "Read-only collection and calculations" },
    runs: [],
    policy: "Agents can produce research and proposals only. Human approval remains mandatory.",
  },
  forecastAnalytics: { sampleSize: 0, brierScore: null, logLoss: null, accuracy: null, pendingResolutionCount: 0 },
  alpaca: { enabled: false, state: "disabled", paperOnly: true, liveOrders: false, snapshots: [], cryptoSnapshots: [], news: [] },
  decisionLayer: { ranked: [], calendar: [], policy: "" },
  professionalAnalytics: { calibration: { sampleSize: 0, expectedCalibrationError: null, buckets: [] }, execution: { sampleSize: 0, fillRate: null, averageSlippage: null }, stressTests: [], lineage: { forecastSnapshots: 0, marketSnapshots: 0, auditEvents: 0 } },
};

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `Request failed with HTTP ${response.status}`);
  return body as T;
}

function money(value: unknown, digits = 2): string {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number.isFinite(number) ? number : 0);
}

function percent(value: unknown, digits = 1): string {
  const number = Number(value ?? 0);
  return `${(Number.isFinite(number) ? number * 100 : 0).toFixed(digits)}%`;
}

function price(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(number >= 1 ? 0 : 2) : "—";
}

function size(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—";
}

function dateTime(value: unknown): string {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("en-IE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function timeAgo(value: unknown): string {
  if (!value) return "never";
  const age = Date.now() - Date.parse(String(value));
  if (!Number.isFinite(age) || age < 0) return "just now";
  if (age < 60_000) return "just now";
  if (age < 3_600_000) return `${Math.round(age / 60_000)}m ago`;
  return `${Math.round(age / 3_600_000)}h ago`;
}

function toneForStatus(value: string): "good" | "warn" | "bad" | undefined {
  const status = value.toLowerCase();
  if (["connected", "eligible", "filled", "completed", "active", "pass", "paper"].some((item) => status.includes(item))) return "good";
  if (["stale", "paper_only", "unknown", "not_checked", "pending", "processing"].some((item) => status.includes(item))) return "warn";
  if (["unavailable", "failed", "rejected", "halt", "closed", "permission"].some((item) => status.includes(item))) return "bad";
  return undefined;
}

function StatusChip({ label, value, tone }: { label?: string; value: string; tone?: "good" | "warn" | "bad" }) {
  return (
    <span className={`status-chip ${tone ?? toneForStatus(value) ?? ""}`}>
      <span className={`status-dot ${tone ?? toneForStatus(value) ?? ""}`} aria-hidden="true" />
      {label ? <span className="text-[#7f9694]">{label}</span> : null}
      <span>{value}</span>
    </span>
  );
}

function MetricCard({ label, value, detail, icon: Icon, tone = "neutral" }: { label: string; value: string; detail: string; icon: typeof Activity; tone?: "neutral" | "positive" | "negative" | "warning" }) {
  return (
    <div className="surface min-w-0 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="metric-caption">{label}</span>
        <Icon className={`size-4 ${tone === "positive" ? "text-[#9fe3c2]" : tone === "negative" ? "text-[#ef8e8e]" : tone === "warning" ? "text-[#efbd72]" : "text-[#82a6a3]"}`} />
      </div>
      <div className="metric-number">{value}</div>
      <div className="mt-2 text-xs text-[#86a09c]">{detail}</div>
    </div>
  );
}

function SectionHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
        <h2 className="section-title">{title}</h2>
        {description ? <p className="mt-2 max-w-2xl text-sm leading-6 text-[#8da4a1]">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function IconForTab({ name }: { name: string }) {
  const props = { className: "size-4" };
  if (name === "overview") return <Gauge {...props} />;
  if (name === "markets") return <Layers3 {...props} />;
  if (name === "research") return <BookOpen {...props} />;
  if (name === "proposals") return <ClipboardCheck {...props} />;
  if (name === "portfolio") return <WalletCards {...props} />;
  if (name === "risk") return <ShieldCheck {...props} />;
  if (name === "decision") return <FileCheck2 {...props} />;
  if (name === "deep-research") return <Search {...props} />;
  if (name === "helper") return <MessageCircle {...props} />;
  return <Settings2 {...props} />;
}

function MarketState({ market }: { market: Market }) {
  if (market.dataOrigin === "demo") return <StatusChip value="Paper only" tone="warn" />;
  if (market.resolutionStatus !== "verified") return <StatusChip value="Resolution unclear" tone="warn" />;
  if (market.status === "closed") return <StatusChip value="Market closed" tone="bad" />;
  if (market.permissionStatus === "unavailable" || !market.yes?.eligible || !market.no?.eligible) return <StatusChip value="Permission unavailable" tone="bad" />;
  if (!market.yes?.quoteFresh || !market.no?.quoteFresh) return <StatusChip value="Stale data" tone="warn" />;
  if (market.eligible) return <StatusChip value="Eligible" tone="good" />;
  return <StatusChip value="Stale / not checked" tone="warn" />;
}

function EmptyState({ icon: Icon, title, description, action }: { icon: typeof Info; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <Icon className="mx-auto mb-3 size-5 text-[#85aaa3]" />
      <p className="font-medium text-[#c6d7d3]">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm leading-6">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export default function DashboardClient({ displayName, email, signOutPath }: { displayName: string; email: string; signOutPath?: string }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [helperOpen, setHelperOpen] = useState(false);
  const [deepResearch, setDeepResearch] = useState<StockSnapshot | null>(null);
  const [state, setState] = useState<DashboardState>(FALLBACK_STATE);
  const [markets, setMarkets] = useState<Market[]>(FALLBACK_MARKETS);
  const [proposals, setProposals] = useState<Proposal[]>(FALLBACK_STATE.proposals);
  const [selectedMarketId, setSelectedMarketId] = useState(FALLBACK_MARKETS[0].id);
  const [research, setResearch] = useState<ResearchResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [researchLoading, setResearchLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftSettings, setDraftSettings] = useState<AppSettings>(FALLBACK_SETTINGS);
  const [resolutionTarget, setResolutionTarget] = useState<AnyRow | null>(null);

  async function loadDeepResearch(ticker: string): Promise<StockSnapshot> {
    const response = await apiRequest<StockSnapshot>(`/api/stock/${encodeURIComponent(ticker)}`);
    setDeepResearch(response);
    return response;
  }

  const refreshData = useCallback(async () => {
    setRefreshing(true);
    try {
      const [status, contracts, proposalRows] = await Promise.all([
        apiRequest<DashboardState>("/api/status"),
        apiRequest<{ markets: Market[] }>("/api/contracts"),
        apiRequest<{ proposals: Proposal[] }>("/api/proposals"),
      ]);
      setState(status);
      setMarkets(contracts.markets.length ? contracts.markets : FALLBACK_MARKETS);
      setProposals(proposalRows.proposals);
      setDraftSettings(status.settings);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The durable data source is unavailable.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const firstRefresh = window.setTimeout(() => void refreshData(), 0);
    const timer = window.setInterval(() => void refreshData(), 30_000);
    return () => {
      window.clearTimeout(firstRefresh);
      window.clearInterval(timer);
    };
  }, [refreshData]);

  useEffect(() => {
    const selected = markets.find((market) => market.id === selectedMarketId);
    if (selected || !markets[0]) return;
    const nextMarketId = markets[0].id;
    const timer = window.setTimeout(() => setSelectedMarketId(nextMarketId), 0);
    return () => window.clearTimeout(timer);
  }, [markets, selectedMarketId]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileNavOpen]);

  const selectedMarket = markets.find((market) => market.id === selectedMarketId) ?? markets[0];
  const pendingProposals = proposals.filter((proposal) => proposal.status === "pending");

  async function runAnalysis(market: Market = selectedMarket) {
    if (!market?.yes?.contractId) return;
    setSelectedMarketId(market.id);
    setActiveTab("research");
    setResearchLoading(true);
    try {
      const workflow = await apiRequest<{ result: ResearchResult }>("/api/agents", { method: "POST", body: JSON.stringify({ contractId: market.yes.contractId }) });
      setResearch(workflow.result);
      toast.success(workflow.result.proposal ? "Research complete — a proposal is ready for review." : "Research complete — no proposal passed the configured gates.");
      await refreshData();
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Research could not be completed.");
    } finally {
      setResearchLoading(false);
    }
  }

  async function syncCatalog() {
    setActionLoading("catalog-sync");
    try {
      await apiRequest("/api/bridge/sync", { method: "POST", body: "{}" });
      toast.success("Catalog sync queued. The bridge will report contracts and fresh quotes over HTTPS.");
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Catalog sync could not be queued.");
    } finally {
      setActionLoading(null);
    }
  }

  async function syncAlpaca() {
    setActionLoading("alpaca-sync");
    try {
      await apiRequest("/api/alpaca/sync", { method: "POST", body: "{}" });
      toast.success("Alpaca context sync queued. The Windows bridge will fetch official market data and news.");
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Alpaca sync could not be queued.");
    } finally {
      setActionLoading(null);
    }
  }

  async function proposalAction(proposal: Proposal, action: "approve" | "reject" | "cancel") {
    setActionLoading(`${action}:${proposal.id}`);
    try {
      const response = await apiRequest<{ order?: AnyRow; status?: string }>(`/api/proposals/${proposal.id}/${action}`, { method: "POST", body: "{}" });
      toast.success(action === "approve" ? (response.route === "ibkr_tws_api" ? "Approved and sent to IBKR Paper; watch TWS for the order status." : response.order?.mode === "paper" ? "Website paper order filled and portfolio updated." : "Approved; waiting for the bridge.") : `Proposal ${action}ed.`);
      await refreshData();
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "The proposal action failed.");
    } finally {
      setActionLoading(null);
    }
  }

  async function toggleKillSwitch() {
    const next = !state.killSwitch;
    if (next && !window.confirm("Activate the kill switch? New proposals and live commands will stop.")) return;
    setActionLoading("kill-switch");
    try {
      await apiRequest("/api/kill-switch", { method: "POST", body: JSON.stringify({ active: next, reason: next ? "Activated from the dashboard." : "Cleared from the dashboard." }) });
      toast.success(next ? "Kill switch active." : "Kill switch cleared.");
      await refreshData();
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Kill switch update failed.");
    } finally {
      setActionLoading(null);
    }
  }

  async function saveSettings() {
    setActionLoading("settings");
    try {
      const saved = await apiRequest<AppSettings>("/api/settings", { method: "POST", body: JSON.stringify({
        mode: draftSettings.mode,
        paperExecutionTarget: draftSettings.paperExecutionTarget,
        manualApprovalRequired: draftSettings.manualApprovalRequired,
        allowMarketOrders: draftSettings.allowMarketOrders,
        watchlist: draftSettings.watchlist,
        minEdge: Number(draftSettings.minEdge),
        minConfidence: Number(draftSettings.minConfidence),
        maxPositionPerContractUsd: Number(draftSettings.maxPositionPerContractUsd),
        maxTotalExposureUsd: Number(draftSettings.maxTotalExposureUsd),
        maxOrderSizeUsd: Number(draftSettings.maxOrderSizeUsd),
        maxDailyLossUsd: Number(draftSettings.maxDailyLossUsd),
        startingCapitalUsd: Number(draftSettings.startingCapitalUsd),
        minAccountFloorPercent: Number(draftSettings.minAccountFloorPercent),
        maxConcurrentOrders: Number(draftSettings.maxConcurrentOrders),
        maxSlippagePercent: Number(draftSettings.maxSlippagePercent),
        orderTimeoutSeconds: Number(draftSettings.orderTimeoutSeconds),
        researchRefreshMinutes: Number(draftSettings.researchRefreshMinutes),
        newsRssUrls: draftSettings.newsRssUrls,
        llmProvider: draftSettings.llmProvider,
        llmModel: draftSettings.llmModel,
      }) });
      setDraftSettings(saved);
      toast.success("Settings saved.");
      await refreshData();
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Settings could not be saved.");
    } finally {
      setActionLoading(null);
    }
  }

  async function toggleWatchlist(marketId: string) {
    const nextWatchlist = state.settings.watchlist.includes(marketId)
      ? state.settings.watchlist.filter((id) => id !== marketId)
      : [...state.settings.watchlist, marketId];
    setActionLoading(`watch:${marketId}`);
    try {
      const saved = await apiRequest<AppSettings>("/api/settings", {
        method: "POST",
        body: JSON.stringify({ watchlist: nextWatchlist }),
      });
      setDraftSettings(saved);
      toast.success(nextWatchlist.includes(marketId) ? "Added to watchlist." : "Removed from watchlist.");
      await refreshData();
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Watchlist could not be updated.");
    } finally {
      setActionLoading(null);
    }
  }

  async function resetPortfolio() {
    if (!window.confirm("Reset the simulated portfolio and paper history? This cannot be undone.")) return;
    setActionLoading("reset");
    try {
      await apiRequest("/api/portfolio/reset", { method: "POST", body: JSON.stringify({ startingBalance: Number(draftSettings.startingCapitalUsd) }) });
      toast.success("Paper portfolio reset.");
      await refreshData();
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Portfolio reset failed.");
    } finally {
      setActionLoading(null);
    }
  }

  async function simulateResolution(position: AnyRow) {
    setResolutionTarget(position);
  }

  async function confirmResolution(outcome: "YES" | "NO") {
    const position = resolutionTarget;
    if (!position) return;
    setResolutionTarget(null);
    setActionLoading(`resolve:${position.contract_id}`);
    try {
      await apiRequest("/api/portfolio/resolve", { method: "POST", body: JSON.stringify({ contractId: position.contract_id, outcome }) });
      toast.success("Resolution simulated and recorded.");
      await refreshData();
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Resolution simulation failed.");
    } finally {
      setActionLoading(null);
    }
  }

  async function replayProposal(proposal: Proposal) {
    setActionLoading(`replay:${proposal.id}`);
    try {
      await apiRequest("/api/portfolio/replay", { method: "POST", body: JSON.stringify({ proposalId: proposal.id }) });
      toast.success("Proposal replayed into the paper queue.");
      await refreshData();
      setActiveTab("proposals");
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Replay failed.");
    } finally {
      setActionLoading(null);
    }
  }

  async function exportHistory() {
    try {
      const response = await fetch("/api/portfolio/export");
      if (!response.ok) throw new Error("Export could not be created.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "paper-trading-history.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Export failed.");
    }
  }

  const currentModeTone = state.mode === "live" ? "warn" : "good";
  return (
    <div className="app-shell">
      {mobileNavOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Mobile navigation">
          <button type="button" className="absolute inset-0 bg-[#020708]/75 backdrop-blur-[2px]" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />
          <aside className="relative z-10 flex h-full w-[min(22rem,86vw)] flex-col border-r border-[#294343] bg-[#09161a] shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#203638] px-5 pb-5 pt-6">
              <div className="flex min-w-0 items-center gap-3">
                <span className="brand-mark shrink-0">EC</span>
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold tracking-tight text-[#e5f1ed]">Event Contract</p>
                  <p className="mono mt-1 text-[0.66rem] tracking-[0.18em] text-[#78908e]">WORKBENCH / PAPER</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="h-10 w-10 shrink-0 px-0 text-[#abc1bc] hover:bg-[#142a2c] hover:text-[#effaf5]" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}>
                <X className="size-5" />
              </Button>
            </div>

            <div className="px-5 py-5">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-[#30494a] bg-[#122a25] px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="size-2.5 shrink-0 rounded-full bg-[#a8ee72] shadow-[0_0_0_5px_rgba(168,238,114,0.1)]" aria-hidden="true" />
                  <span className="truncate text-sm font-medium text-[#c9f0a9]">Public paper workspace</span>
                </div>
                <LockKeyhole className="size-4 shrink-0 text-[#b4e58d]" aria-hidden="true" />
              </div>
            </div>

            <nav className="min-h-0 flex-1 overflow-y-auto border-t border-[#203638] px-4 py-6" aria-label="Mobile navigation">
              <p className="eyebrow mb-4 px-3">Workspace</p>
              <div className="space-y-1">
                {[["overview", "Luna Max"], ["helper", "Ask Luna"], ["markets", "Event markets"], ["research", "Research"], ["portfolio", "Paper portfolio"], ["risk", "Risk"], ["decision", "Decision lab"], ["deep-research", "Deep research"], ["proposals", "Proposals"], ["settings", "Settings"]].map(([value, label]) => (
                  <button key={value} type="button" onClick={() => { setActiveTab(value); setMobileNavOpen(false); }} className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[0.95rem] transition-colors ${activeTab === value ? "bg-[#193630] text-[#d8f2bd]" : "text-[#91aaa7] hover:bg-[#142a2c] hover:text-[#d8e8e3]"}`}>
                    <IconForTab name={value} />
                    <span>{label}</span>
                    {value === "proposals" && pendingProposals.length > 0 ? <span className="ml-auto rounded-full bg-[#efbd72]/15 px-2 py-0.5 text-xs text-[#efc98f]">{pendingProposals.length}</span> : null}
                  </button>
                ))}
              </div>
            </nav>

            <div className="border-t border-[#203638] px-5 py-5">
              <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[#406955] bg-[#153329] text-sm font-semibold text-[#bce996]">{(displayName || "AP").slice(0, 2).toUpperCase()}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[#d8e7e3]">{displayName || "Paper trader"}</p>
                  <p className="truncate text-xs text-[#78918e]">Paper access · owner controls</p>
                </div>
              </div>
              {signOutPath ? <a className="mt-3 inline-block pl-[3.25rem] text-xs text-[#8dc8b0] hover:underline" href={signOutPath} target="_top">Sign out</a> : null}
            </div>
          </aside>
        </div>
      ) : null}
      <div className="grid min-h-screen lg:grid-cols-[15.5rem_minmax(0,1fr)]">
        <aside className="sidebar-panel hidden flex-col justify-between p-5 lg:flex">
          <div>
            <div className="mb-10 flex items-center gap-3">
              <span className="brand-mark">EC</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold tracking-tight text-[#e5f1ed]">Event Contract</p>
                <p className="mono text-[0.68rem] text-[#78908e]">WORKBENCH / PUBLIC PAPER</p>
              </div>
            </div>
            <div className="mb-7 rounded-xl border border-[#30494a] bg-[#122425] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="mono text-[0.66rem] uppercase tracking-[0.12em] text-[#7faaa1]">Environment</span>
                <Badge className="border-[#9fe3c2]/30 bg-[#9fe3c2]/10 text-[#b8efd0]">{state.mode.toUpperCase()}</Badge>
              </div>
              <p className="mt-3 text-xs leading-5 text-[#afc3be]">Paper approvals use IBKR TWS when selected in Settings. Live trading remains disabled.</p>
            </div>
            <nav className="space-y-1" aria-label="Primary navigation">
              {[["overview", "Overview"], ["markets", "Event markets"], ["research", "Research"], ["proposals", "Proposals"], ["portfolio", "Paper portfolio"], ["risk", "Risk"], ["decision", "Decision lab"], ["deep-research", "Deep research"], ["helper", "Ask Luna"], ["settings", "Settings"]].map(([value, label]) => (
                <button key={value} type="button" onClick={() => setActiveTab(value)} className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors ${activeTab === value ? "bg-[#1b3c39] text-[#dcf4e8]" : "text-[#88a09d] hover:bg-[#142a2c] hover:text-[#d8e8e3]"}`}>
                  <IconForTab name={value} />
                  <span>{label}</span>
                  {value === "proposals" && pendingProposals.length > 0 ? <span className="ml-auto rounded-full bg-[#efbd72]/15 px-2 py-0.5 text-xs text-[#efc98f]">{pendingProposals.length}</span> : null}
                </button>
              ))}
            </nav>
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-[#7f9694]"><LockKeyhole className="size-3.5" /> Public paper workspace</div>
            <div className="border-t border-[#1e3032] pt-3">
              <p className="truncate text-sm text-[#c5d6d2]">{displayName}</p>
              <p className="truncate text-xs text-[#77908d]">{email}</p>
              {signOutPath ? <a className="mt-2 inline-block text-xs text-[#8dc8b0] hover:underline" href={signOutPath} target="_top">Sign out</a> : null}
            </div>
          </div>
        </aside>

        <main className="min-w-0">
          <header className="topbar sticky top-0 z-20 px-4 py-3 sm:px-6 lg:px-8">
            <div className="mx-auto flex max-w-[118rem] items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Button variant="ghost" size="sm" className="h-10 w-10 shrink-0 px-0 text-[#b5cbc6] hover:bg-[#142a2c] hover:text-[#effaf5] lg:hidden" aria-label="Open navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}>
                  <Menu className="size-5" />
                </Button>
                <span className="brand-mark lg:hidden">EC</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold tracking-tight text-[#e7f1ee]">IBKR Event Contract Workbench</p>
                  <p className="hidden text-xs text-[#7d9692] sm:block">Research, paper execution and guarded bridge control</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusChip value={state.mode === "live" ? "LIVE" : "PAPER"} tone={currentModeTone} />
                <Button variant="outline" size="sm" onClick={() => setHelperOpen(true)} className="border-[#8fd6b2]/40 bg-[#17302a]/40 text-[#bfe8d1]" aria-label="Open Ask Luna helper">
                  <MessageCircle className="size-3.5" />
                  <span>Ask Luna</span>
                </Button>
                <Button variant="outline" size="sm" onClick={() => void toggleKillSwitch()} disabled={actionLoading === "kill-switch"} className={state.killSwitch ? "border-[#ef8e8e]/50 text-[#f4aaaa]" : "border-[#385053] text-[#b4c7c2]"}>
                  <Zap className="size-3.5" />
                  <span className="hidden sm:inline">{state.killSwitch ? "Kill switch on" : "Kill switch"}</span>
                </Button>
              </div>
            </div>
          </header>

          <div className="mx-auto w-full max-w-[118rem] px-4 pb-10 pt-5 sm:px-6 lg:px-8">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="eyebrow mb-2">CONTROL SURFACE / {state.mode.toUpperCase()}</p>
                <h1 className="text-2xl font-semibold tracking-[-0.045em] text-[#edf7f3] sm:text-3xl">Good decisions need a clear state.</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#91a6a2]">A private workspace for contract discovery, evidence review and simulated execution. Estimates are labelled; approvals are always explicit.</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-[#78918d]"><RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refreshed {timeAgo(state.lastDataRefresh)}</div>
            </div>

            {error ? <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#efbd72]/30 bg-[#4d3820]/20 px-4 py-3 text-sm text-[#e8c992]" role="status"><span><AlertTriangle className="mr-2 inline size-4" />{error} Showing the last usable paper view where available.</span><Button variant="outline" size="sm" onClick={() => void refreshData()}>Try again</Button></div> : null}

            <Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0">
              <TabsList className="hidden">
                {[["overview", "Overview"], ["markets", "Markets"], ["research", "Research"], ["proposals", "Proposals"], ["portfolio", "Portfolio"], ["risk", "Risk"], ["decision", "Decision lab"], ["deep-research", "Deep research"], ["helper", "Ask Luna"], ["settings", "Settings"]].map(([value, label]) => (
                  <TabsTrigger key={value} value={value} className="tab-trigger"><IconForTab name={value} />{label}{value === "proposals" && pendingProposals.length > 0 ? <span className="rounded-full bg-[#efbd72]/15 px-1.5 text-[0.65rem] text-[#efc98f]">{pendingProposals.length}</span> : null}</TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="overview"><Overview state={state} proposals={pendingProposals} markets={markets} onResearch={runAnalysis} onProposalAction={proposalAction} actionLoading={actionLoading} onOpenTab={setActiveTab} onOpenHelper={() => setHelperOpen(true)} onSyncAlpaca={syncAlpaca} /></TabsContent>
              <TabsContent value="markets"><Markets markets={markets} watchlist={state.settings.watchlist} bridgeConfigured={state.settings.bridgeConfigured} onSyncCatalog={syncCatalog} syncLoading={actionLoading === "catalog-sync"} onResearch={runAnalysis} onToggleWatchlist={toggleWatchlist} onOpenResearch={(market) => { setSelectedMarketId(market.id); setActiveTab("research"); }} /></TabsContent>
              <TabsContent value="research"><ResearchPanel markets={markets} selectedMarket={selectedMarket} selectedMarketId={selectedMarketId} setSelectedMarketId={setSelectedMarketId} research={research} loading={researchLoading} onRun={() => void runAnalysis()} /></TabsContent>
              <TabsContent value="proposals"><Proposals proposals={proposals} onAction={proposalAction} onReplay={replayProposal} actionLoading={actionLoading} /></TabsContent>
              <TabsContent value="portfolio"><Portfolio portfolio={state.portfolio} proposals={proposals} onReset={resetPortfolio} onExport={exportHistory} onResolve={simulateResolution} onReplay={replayProposal} actionLoading={actionLoading} /></TabsContent>
              <TabsContent value="risk"><RiskPanel state={state} onToggleKillSwitch={toggleKillSwitch} actionLoading={actionLoading} /></TabsContent>
              <TabsContent value="decision"><DecisionLab state={state} markets={markets} /></TabsContent>
              <TabsContent value="deep-research"><DeepResearchPanel snapshot={deepResearch} onLoad={loadDeepResearch} onCreateProposal={async (ticker, quantity) => { await apiRequest("/api/stock-proposals", { method: "POST", body: JSON.stringify({ ticker, quantity }) }); toast.success(`${ticker} paper proposal created. Review it in Proposals.`); await refreshData(); setActiveTab("proposals"); }} /></TabsContent>
              <TabsContent value="helper"><HelperPanel state={state} selectedMarket={selectedMarket} /></TabsContent>
              <TabsContent value="settings"><SettingsPanel settings={draftSettings} setSettings={setDraftSettings} onSave={saveSettings} actionLoading={actionLoading} /></TabsContent>
            </Tabs>

            <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-[#1b2b2d] pt-4 text-xs leading-5 text-[#6f8884]">
              <span><Info className="mr-1 inline size-3.5" />Research outputs are estimates, not facts or investment advice.</span>
              <span className="mono">D1 durable state · no browser order submission</span>
            </footer>
          </div>
        </main>
      </div>
      {resolutionTarget ? <div className="fixed inset-0 z-50 grid place-items-center bg-[#020708]/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="resolution-dialog-title"><div className="surface w-full max-w-md p-5 sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">PAPER SIMULATION</p><h2 id="resolution-dialog-title" className="mt-2 text-lg font-semibold text-[#e4f0ec]">Simulate contract resolution</h2></div><Button variant="ghost" size="sm" onClick={() => setResolutionTarget(null)} aria-label="Close resolution dialog">Close</Button></div><p className="question-wrap mt-4 text-sm leading-6 text-[#afc3bd]">{String(resolutionTarget.question ?? resolutionTarget.contract_id)}</p><p className="mt-2 text-xs leading-5 text-[#7f9994]">Choose the settled outcome. This changes only the simulated paper portfolio and is recorded in the audit history.</p><div className="mt-5 grid grid-cols-2 gap-3"><Button className="min-h-11" onClick={() => void confirmResolution("YES")}>Resolve YES</Button><Button variant="outline" className="min-h-11" onClick={() => void confirmResolution("NO")}>Resolve NO</Button></div></div></div> : null}
      {helperOpen ? <aside className="helper-popover" role="dialog" aria-modal="false" aria-labelledby="helper-popover-title"><div className="helper-popover-header"><div className="flex min-w-0 items-center gap-2"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#9fe3c2]/12 text-[#bfe8d1]"><MessageCircle className="size-5" /></span><div className="min-w-0"><h2 id="helper-popover-title" className="truncate text-sm font-semibold text-[#e4f0ec]">Ask Luna</h2><p className="text-xs text-[#86a49c]">Advisory workbench helper</p></div></div><Button variant="ghost" size="sm" onClick={() => setHelperOpen(false)} aria-label="Close Ask Luna helper">Close</Button></div><div className="helper-popover-body"><HelperPanel state={state} selectedMarket={selectedMarket} /></div></aside> : null}
      <button type="button" onClick={() => setHelperOpen((open) => !open)} className={`helper-fab ${helperOpen ? "helper-fab-open" : ""}`} aria-label={helperOpen ? "Close Ask Luna helper" : "Open Ask Luna helper"} title={helperOpen ? "Close Luna" : "Ask Luna"}><MessageCircle className="size-6" /><span className="sr-only">Ask Luna</span></button>
    </div>
  );
}

function Overview({ state, proposals, markets, onResearch, onProposalAction, actionLoading, onOpenTab, onOpenHelper, onSyncAlpaca }: { state: DashboardState; proposals: Proposal[]; markets: Market[]; onResearch: (market: Market) => void; onProposalAction: (proposal: Proposal, action: "approve" | "reject" | "cancel") => void; actionLoading: string | null; onOpenTab: (tab: string) => void; onOpenHelper: () => void; onSyncAlpaca: () => void }) {
  const forecastSeries = Array.isArray(state.forecastAnalytics?.forecasts) ? state.forecastAnalytics.forecasts.slice(0, 12).reverse() : [];
  return (
    <div className="data-grid">
      <section className="surface min-w-0 p-5 sm:p-6">
        <SectionHeading eyebrow="Professional data layer" title="Evidence, AI and execution" description="Research uses real external data when available; the AI explains evidence and uncertainty; deterministic risk controls gate every approval; selected paper orders can be sent to local IBKR TWS." action={<StatusChip value={String(state.dataHealth?.status ?? "awaiting_data").replace("_", " ")} />} />
        <button type="button" onClick={onOpenHelper} className="helper-launch-card mb-4 flex w-full items-start gap-3 rounded-xl border border-[#79c99f]/30 bg-[#15332d]/55 p-4 text-left transition-colors hover:border-[#9fe3c2]/65 hover:bg-[#194039] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9fe3c2]">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#9fe3c2]/12 text-[#bfe8d1]"><MessageCircle className="size-5" /></span>
          <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[#e0f1e9]">Ask Luna <StatusChip value="5.6 Luna Max" tone="good" /></span><span className="mt-1 block text-sm leading-6 text-[#9fbbb3]">Get help with the current market, risk checks, paper trading or the next research step. Luna is advisory-only and cannot place orders.</span></span><ArrowUpRight className="mt-1 size-4 shrink-0 text-[#9fdcc0]" />
        </button>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Market snapshots" value={size(state.dataHealth?.marketSnapshots)} detail={state.dataHealth?.lastMarketSnapshot ? `Last ${timeAgo(state.dataHealth.lastMarketSnapshot)}` : "Awaiting Windows bridge"} icon={LineChart} />
          <MetricCard label="Forecast snapshots" value={size(state.dataHealth?.forecastSnapshots)} detail={state.dataHealth?.lastForecastSnapshot ? `Last ${timeAgo(state.dataHealth.lastForecastSnapshot)}` : "Created from validated runs"} icon={TrendingUp} />
          <MetricCard label="Brier score" value={state.forecastAnalytics?.brierScore == null ? "—" : Number(state.forecastAnalytics.brierScore).toFixed(3)} detail={`${size(state.forecastAnalytics?.sampleSize)} resolved forecasts`} icon={BarChart3} />
          <MetricCard label="Walk-forward Brier" value={state.forecastAnalytics?.walkForward?.brierScore == null ? "—" : Number(state.forecastAnalytics.walkForward.brierScore).toFixed(3)} detail={`${size(state.forecastAnalytics?.walkForward?.sampleSize)} out-of-sample forecasts`} icon={LineChart} />
          <MetricCard label="Manager" value={String(state.agents?.manager?.model ?? "5.6 Luna Max")} detail="Reviews evidence, uncertainty and risk" icon={Sparkles} />
          <MetricCard label="Worker" value={String(state.agents?.worker?.model ?? "5.6 Luna Medium")} detail="Collects and normalizes read-only data" icon={Database} />
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="surface-muted p-4"><div className="flex items-center justify-between gap-3"><p className="metric-caption">Configured sources</p><Button variant="ghost" size="sm" onClick={() => onOpenTab("settings")}>Manage sources</Button></div><div className="mt-3 flex flex-wrap gap-2">{(state.dataHealth?.sources ?? []).map((source: AnyRow) => <StatusChip key={String(source.id)} value={`${source.name}: ${source.last_success_at ? "ok" : "awaiting"}`} />)}{!(state.dataHealth?.sources ?? []).length ? <span className="text-sm text-[#8da4a1]">Official ECB, CSO, IBKR bridge and configured RSS sources will appear here.</span> : null}</div></div>
          <div className="surface-muted p-4"><div className="flex items-center justify-between gap-3"><p className="metric-caption">Agent policy</p><StatusChip value="Human approval" tone="good" /></div><p className="mt-3 text-sm leading-6 text-[#b7cbc5]">{String(state.agents?.policy ?? "Agents never submit orders directly.")}</p><p className="mt-2 text-xs text-[#78918e]">Recent runs: {(state.agents?.runs ?? []).length} · Data-quality events: {(state.dataHealth?.qualityEvents ?? []).length}</p></div>
        </div>
      </section>
      <section className="surface min-w-0 p-5 sm:p-6">
        <SectionHeading eyebrow="How the AI and data layers work" title="What happens in the background" description="The AI advises; deterministic controls and the broker bridge do the operational work. Every data origin is shown separately so a paper result is not mistaken for an AI prediction." />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="surface-muted p-4"><p className="font-medium text-[#d3e4de]">1 · Worker / Luna Medium</p><p className="mt-2 text-sm leading-6 text-[#9fb8b1]">Collects current quotes, company snapshots, history, competitors and configured news. It does not trade.</p><p className="mt-3 text-xs text-[#86aaa2]">Sources: Windows yfinance, Yahoo fallback, IBKR and optional Alpaca.</p></div>
          <div className="surface-muted p-4"><p className="font-medium text-[#d3e4de]">2 · Research brief</p><p className="mt-2 text-sm leading-6 text-[#9fb8b1]">Turns the latest evidence into context/catalysts, valuation/growth, competitors/risks and explicit uncertainty. It is analysis, not a signal.</p><p className="mt-3 text-xs text-[#86aaa2]">AI provider: {state.settings.llmProvider === "openai" ? state.settings.llmModel : "deterministic baseline"}.</p></div>
          <div className="surface-muted p-4"><p className="font-medium text-[#d3e4de]">3 · Risk engine</p><p className="mt-2 text-sm leading-6 text-[#9fb8b1]">Rechecks quote freshness, price ceiling, order size, exposure, cash, concurrency, account floor and kill switch at approval.</p><p className="mt-3 text-xs text-[#86aaa2]">Deterministic; it cannot be overridden by Luna.</p></div>
          <div className="surface-muted p-4"><p className="font-medium text-[#d3e4de]">4 · Execution</p><p className="mt-2 text-sm leading-6 text-[#9fb8b1]">With IBKR Paper selected, human approval queues a limit order to your local TWS API. TWS supplies the real paper account, quote and fill status.</p><p className="mt-3 text-xs text-[#86aaa2]">Live trading remains disabled: {state.liveTradingEnabled ? "server gate enabled" : "fail-closed"}.</p></div>
        </div>
      </section>
      <section className="grid min-w-0 gap-4 xl:grid-cols-[1.2fr_.8fr]">
        <div className="surface min-w-0 p-5 sm:p-6">
          <SectionHeading eyebrow="Forecast laboratory" title="Model versus market" description="Stored forecast snapshots make probability drift visible over time. This is a decision-quality benchmark, not a performance guarantee." action={<StatusChip value={`${forecastSeries.length} observations`} />} />
          {forecastSeries.length >= 2 ? <ProbabilityChart points={forecastSeries} /> : <EmptyState icon={LineChart} title="Chart awaits more snapshots" description="Run research and keep the bridge collecting market data to build a durable model-versus-market history." />}
        </div>
        <div className="surface min-w-0 p-5 sm:p-6">
          <SectionHeading eyebrow="Portfolio shape" title="Exposure profile" description="Current simulated exposure against each configured contract cap." />
          {state.risk.exposureByContract?.length ? <div className="space-y-4">{state.risk.exposureByContract.slice(0, 6).map((row: AnyRow) => <div key={String(row.contractId)}><div className="mb-1 flex items-start justify-between gap-3 text-xs"><span className="question-wrap text-[#b8ccc6]">{row.question}</span><span className="mono text-[#bfe8d1]">{money(row.exposure)}</span></div><ProgressLine label="" value={Number(row.exposure)} max={Number(state.risk.settings.maxPositionPerContractUsd ?? 50)} display={`${percent(Number(row.exposure) / Math.max(1, Number(state.risk.settings.maxPositionPerContractUsd ?? 50)))}`} /></div>)}</div> : <EmptyState icon={BarChart3} title="No open exposure" description="Approved paper positions will populate the exposure profile." />}
        </div>
      </section>
      <section className="surface min-w-0 p-5 sm:p-6">
        <SectionHeading eyebrow="Professional controls" title="Decision-quality diagnostics" description="The workbench now separates forecast quality, execution quality and portfolio stress. These measures are calculated from timestamped records and should be judged over a meaningful sample." action={<StatusChip value={`${size(state.professionalAnalytics?.lineage?.auditEvents)} audit events`} />} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Calibration error" value={state.professionalAnalytics?.calibration?.expectedCalibrationError == null ? "—" : Number(state.professionalAnalytics.calibration.expectedCalibrationError).toFixed(3)} detail={`${size(state.professionalAnalytics?.calibration?.sampleSize)} resolved forecasts`} icon={Gauge} />
          <MetricCard label="Fill rate" value={state.professionalAnalytics?.execution?.fillRate == null ? "—" : percent(state.professionalAnalytics.execution.fillRate)} detail={`${size(state.professionalAnalytics?.execution?.sampleSize)} observed orders`} icon={CheckCircle2} />
          <MetricCard label="Execution slippage" value={state.professionalAnalytics?.execution?.averageSlippage == null ? "—" : percent(state.professionalAnalytics.execution.averageSlippage)} detail="Average fill minus limit reference" icon={TrendingDown} tone={Number(state.professionalAnalytics?.execution?.averageSlippage ?? 0) > 0 ? "negative" : "positive"} />
          <MetricCard label="Stored market history" value={size(state.professionalAnalytics?.lineage?.marketSnapshots)} detail="Timestamped snapshots" icon={Database} />
          <MetricCard label="Edge trend" value={String(state.professionalAnalytics?.edgeDecay?.trend ?? "insufficient_data").replaceAll("_", " ")} detail="Observed execution reference" icon={Activity} />
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">{(state.professionalAnalytics?.stressTests ?? []).map((scenario: AnyRow) => <div key={String(scenario.shock)} className={`surface-muted p-3 ${scenario.breachesFloor ? "border border-[#ef8e8e]/30" : ""}`}><div className="flex justify-between gap-3 text-xs text-[#8da6a1]"><span>Stress shock</span><span className="mono">{percent(Number(scenario.shock))}</span></div><p className="mt-2 mono text-lg text-[#d6e8e1]">-{money(scenario.estimatedLoss)}</p><p className="mt-1 text-xs text-[#7d9691]">Capital after shock: {money(scenario.capitalAfterShock)}{scenario.breachesFloor ? " · floor breach" : ""}</p></div>)}</div>
      </section>
      <section className="grid min-w-0 gap-4 xl:grid-cols-[1.1fr_.9fr]">
        <div className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Decision pipeline" title="Best opportunities" description="Triage ranking combines market quality, freshness, resolution readiness and liquidity. It does not override the trade gates." action={<StatusChip value="Risk-gated" tone="good" />} />{(state.decisionLayer?.ranked ?? []).length ? <div className="space-y-2">{state.decisionLayer.ranked.slice(0, 5).map((row: AnyRow, index: number) => <div key={String(row.id)} className="surface-muted flex items-center gap-3 p-3"><span className="mono w-6 text-sm text-[#7f9994]">{index + 1}</span><div className="min-w-0 flex-1"><p className="question-wrap text-sm text-[#c9dad6]">{row.question}</p><p className="mt-1 text-xs text-[#7f9994]">{row.provider} · Quality {row.quality}/100</p></div><span className="mono text-sm text-[#bfe8d1]">{row.rank}</span></div>)}</div> : <EmptyState icon={Gauge} title="Ranking awaits real market data" description="Connect the bridge to rank eligible contracts by current conditions." />}</div>
        <div className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Calendar" title="Upcoming expiries" description="Use this as a timing prompt; official resolution rules remain authoritative." />{(state.decisionLayer?.calendar ?? []).length ? <div className="space-y-2">{state.decisionLayer.calendar.slice(0, 5).map((row: AnyRow) => <div key={String(row.id)} className="surface-muted p-3"><p className="question-wrap text-sm text-[#c9dad6]">{row.question}</p><p className="mt-1 text-xs text-[#8da6a1]">{dateTime(row.expiration)} · {String(row.resolutionStatus).replace("_", " ")}</p></div>)}</div> : <EmptyState icon={LineChart} title="No calendar data" description="Contract expiries will appear when the Site has market records." />}</div>
      </section>
      <section className="surface min-w-0 p-5 sm:p-6">
        <SectionHeading eyebrow="Cross-market context" title="Alpaca data layer" description="Official Alpaca snapshots, account context and news can challenge or corroborate event-contract research. This connector is paper/read-only and never submits Alpaca orders." action={<div className="flex items-center gap-2"><StatusChip value={String(state.alpaca?.state ?? "disabled").replace("_", " ")} /><Button variant="outline" size="sm" onClick={onSyncAlpaca} disabled={actionLoading === "alpaca-sync" || !state.alpaca?.enabled}><RefreshCw className={`size-3.5 ${actionLoading === "alpaca-sync" ? "animate-spin" : ""}`} />Sync</Button></div>} />
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard label="Alpaca account" value={state.alpaca?.account?.equity ? money(state.alpaca.account.equity) : "—"} detail={state.alpaca?.paperOnly ? "Paper account · read-only bridge" : "Not connected"} icon={WalletCards} />
          <MetricCard label="Market snapshots" value={size((state.alpaca?.snapshots ?? []).length + (state.alpaca?.cryptoSnapshots ?? []).length)} detail={state.alpaca?.lastSync ? `Updated ${timeAgo(state.alpaca.lastSync)}` : "Awaiting bridge sync"} icon={LineChart} />
          <MetricCard label="Related news" value={size((state.alpaca?.news ?? []).length)} detail="Official API news context" icon={FileText} />
        </div>
        {(state.alpaca?.snapshots ?? []).length ? <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{state.alpaca.snapshots.slice(0, 8).map((row: AnyRow) => <div key={String(row.symbol)} className="surface-muted flex items-center justify-between gap-3 p-3"><span className="mono text-sm text-[#c8ddd5]">{row.symbol}</span><span className="mono text-sm text-[#a9e6c5]">{price(row.last_price)}</span><span className="text-xs text-[#7f9994]">{row.bid != null && row.ask != null ? `${price(row.bid)} / ${price(row.ask)}` : "quote —"}</span></div>)}</div> : <p className="mt-4 text-sm text-[#819a95]">Enable Alpaca in the Windows bridge environment to add market, portfolio and news context.</p>}
      </section>
      <div className="grid min-w-0 gap-4 xl:grid-cols-[1.35fr_.85fr]">
        <section className="surface min-w-0 p-5 sm:p-6">
          <SectionHeading eyebrow="Live state" title="Control centre" description="The first view keeps mode, connectivity, permission status and risk visible before any action is taken." action={<StatusChip value={state.risk.tradingHalted ? "Trading halted" : "Risk checks clear"} tone={state.risk.tradingHalted ? "bad" : "good"} />} />
          <div className="grid gap-3 sm:grid-cols-2">
            <StateTile icon={Activity} label="IBKR connection" value={state.ibkr.connection} detail={state.ibkr.accountId ? `Account ${state.ibkr.accountId}` : "No account connected"} tone={toneForStatus(String(state.ibkr.connection))} />
            <StateTile icon={Database} label="Bridge" value={state.bridge.state} detail={state.bridge.lastHeartbeat ? `Heartbeat ${timeAgo(state.bridge.lastHeartbeat)}` : "Outbound bridge not configured"} tone={state.bridge.state === "connected" ? "good" : state.bridge.state === "stale" ? "warn" : "bad"} />
            <StateTile icon={ShieldCheck} label="Event contracts" value={String(state.ibkr.eventContractsPermission)} detail={state.mode === "paper" ? "Paper view remains available" : "Permission must be rechecked before execution"} tone={toneForStatus(String(state.ibkr.eventContractsPermission))} />
            <StateTile icon={LockKeyhole} label="Live execution" value={state.liveTradingEnabled ? "Server gate enabled" : "Disabled"} detail={state.liveTradingEnabled ? "Still requires bridge + approval" : "Fails closed by default"} tone={state.liveTradingEnabled ? "warn" : "good"} />
          </div>
        </section>
        <section className="surface min-w-0 p-5 sm:p-6">
          <SectionHeading eyebrow="Today" title="Paper portfolio" action={<Button variant="ghost" size="sm" onClick={() => onOpenTab("portfolio")} className="text-[#9fdbc1]">Open portfolio <ArrowUpRight className="size-3.5" /></Button>} />
          <div className="grid grid-cols-2 gap-4">
            <div><p className="metric-caption">Value</p><p className="mt-2 metric-number">{money(state.portfolio.portfolioValue)}</p></div>
            <div><p className="metric-caption">Today</p><p className={`mt-2 metric-number ${state.portfolio.dailyPnl >= 0 ? "text-[#a9e6c5]" : "text-[#f1a0a0]"}`}>{state.portfolio.dailyPnl >= 0 ? "+" : ""}{money(state.portfolio.dailyPnl)}</p></div>
          </div>
          <div className="mt-6 space-y-3">
            <ProgressLine label="Exposure" value={state.risk.aggregateExposure} max={state.risk.settings.maxTotalExposureUsd ?? 250} display={`${money(state.risk.aggregateExposure)} / ${money(state.risk.settings.maxTotalExposureUsd ?? 250)}`} />
            <ProgressLine label="Account floor" value={state.portfolio.portfolioValue} max={state.portfolio.portfolioValue + (state.portfolio.portfolioValue - (state.risk.accountFloor ?? 200))} display={`${money(state.risk.accountFloor)} floor`} warn={state.portfolio.portfolioValue <= state.risk.accountFloor} />
          </div>
          <div className="mt-6 flex flex-wrap gap-2"><StatusChip value="Simulated" tone="good" /><StatusChip value={`${state.portfolio.positions.length} open positions`} /></div>
        </section>
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Paper cash" value={money(state.portfolio.cash)} detail="Available simulated balance" icon={CircleDollarSign} />
        <MetricCard label="Open proposals" value={String(proposals.length)} detail="Require explicit approval" icon={ClipboardCheck} tone={proposals.length ? "warning" : "neutral"} />
        <MetricCard label="Drawdown" value={money(state.portfolio.drawdown)} detail="From starting capital" icon={state.portfolio.drawdown < 0 ? TrendingDown : TrendingUp} tone={state.portfolio.drawdown < 0 ? "negative" : "positive"} />
        <MetricCard label="Open orders" value={String(state.openOrders)} detail="Paper fills or bridge queue" icon={ScrollText} />
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[1.15fr_.85fr]">
        <section className="surface min-w-0 p-5 sm:p-6">
          <SectionHeading eyebrow="Queue" title="Active proposals" description="Every proposal shows the quote, probability estimate, net edge and the evidence boundary before it can be approved." action={<Button variant="outline" size="sm" onClick={() => onOpenTab("proposals")}>View queue <ArrowUpRight className="size-3.5" /></Button>} />
          {proposals.length ? <div className="space-y-3">{proposals.slice(0, 4).map((proposal) => <ProposalCompact key={String(proposal.id)} proposal={proposal} onAction={onProposalAction} actionLoading={actionLoading} />)}</div> : <EmptyState icon={ClipboardCheck} title="No proposals waiting" description="Run research on a market to create a gated paper proposal." />}
        </section>
        <section className="surface min-w-0 p-5 sm:p-6">
          <SectionHeading eyebrow="Watchlist" title="Markets to review" description="Sample rows are clearly marked as paper-only until the optional bridge reports real contracts and permissions." action={<Button variant="ghost" size="sm" onClick={() => onOpenTab("markets")} className="text-[#9fdbc1]">All markets <ArrowUpRight className="size-3.5" /></Button>} />
          <div className="space-y-3">{markets.slice(0, 3).map((market) => <div key={market.id} className="surface-muted p-3.5"><div className="flex items-start justify-between gap-3"><p className="question-wrap text-sm leading-5 text-[#c9dad6]">{market.question}</p><MarketState market={market} /></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="price-pill">Y {price(market.yes?.price)}</span><span className="price-pill no">N {price(market.no?.price)}</span><span className="mono text-xs text-[#718b88]">{market.provider}</span></div><Button variant="ghost" size="sm" onClick={() => onResearch(market)} className="h-8 text-[#9fdbc1]">Research <ArrowUpRight className="size-3.5" /></Button></div></div>)}</div>
        </section>
      </div>
    </div>
  );
}

function ProbabilityChart({ points }: { points: AnyRow[] }) {
  const width = 640;
  const height = 190;
  const pad = { left: 34, right: 12, top: 16, bottom: 28 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const value = (row: AnyRow, key: "probability" | "marketProbability") => Math.min(1, Math.max(0, Number(row[key] ?? 0)));
  const path = (key: "probability" | "marketProbability") => points.map((row, index) => {
    const x = pad.left + (points.length === 1 ? innerWidth / 2 : index / (points.length - 1) * innerWidth);
    const y = pad.top + (1 - value(row, key)) * innerHeight;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return <div className="min-w-0">
    <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-[#8da6a1]"><span><i className="chart-key manager" />Model estimate</span><span><i className="chart-key market" />Market-implied</span><span className="ml-auto mono">0–100%</span></div>
    <div className="chart-frame" role="img" aria-label="Model and market probability history">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-48 w-full">
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => <g key={tick}><line x1={pad.left} x2={width - pad.right} y1={pad.top + (1 - tick) * innerHeight} y2={pad.top + (1 - tick) * innerHeight} className="chart-grid" /><text x="4" y={pad.top + (1 - tick) * innerHeight + 4} className="chart-label">{Math.round(tick * 100)}%</text></g>)}
        <path d={path("marketProbability")} className="chart-line market" fill="none" />
        <path d={path("probability")} className="chart-line manager" fill="none" />
        {points.map((row, index) => { const x = pad.left + (points.length === 1 ? innerWidth / 2 : index / (points.length - 1) * innerWidth); const y = pad.top + (1 - value(row, "probability")) * innerHeight; return <circle key={`${String(row.contractId)}-${index}`} cx={x} cy={y} r="3" className="chart-point manager" />; })}
      </svg>
    </div>
    <div className="mt-2 flex justify-between gap-2 text-[0.68rem] text-[#718b88]"><span>{points[0]?.observedAt ? dateTime(points[0].observedAt) : "Earlier"}</span><span>{points.at(-1)?.observedAt ? dateTime(points.at(-1)?.observedAt) : "Latest"}</span></div>
  </div>;
}

function DecisionLab({ state, markets }: { state: DashboardState; markets: Market[] }) {
  const diagnostics = state.professionalAnalytics ?? {};
  const ready = markets.filter((market) => market.resolutionStatus === "verified" && market.resolutionSourceUrl).length;
  const unclear = markets.filter((market) => market.resolutionStatus !== "verified" || !market.resolutionSourceUrl).length;
  return <div className="data-grid">
    <section className="surface min-w-0 p-5 sm:p-6">
      <SectionHeading eyebrow="Decision-quality control room" title="Professional decision lab" description="A single review surface for resolution integrity, forecast calibration, model lineage, execution attribution and stress conditions." action={<StatusChip value="Human approval required" tone="good" />} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Resolution-ready" value={String(ready)} detail={String(unclear) + " markets require review"} icon={FileCheck2} tone={unclear ? "warning" : "positive"} />
        <MetricCard label="Forecast sample" value={size(state.forecastAnalytics?.sampleSize)} detail="Resolved outcomes only" icon={BarChart3} />
        <MetricCard label="Lineage events" value={size(diagnostics.lineage?.auditEvents)} detail="Auditable actions retained" icon={ScrollText} />
        <MetricCard label="Stress scenarios" value={String((diagnostics.stressTests ?? []).length)} detail="Portfolio shock cases" icon={AlertTriangle} tone="warning" />
      </div>
    </section>
    <section className="grid min-w-0 gap-4 xl:grid-cols-2">
      <div className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Resolution gate" title="Contract integrity queue" description="A market cannot become a trade candidate unless its source and settlement criteria are verified." /><div className="space-y-2">{markets.slice(0, 8).map((market) => <div key={market.id} className="surface-muted flex min-w-0 items-start justify-between gap-3 p-3"><div className="min-w-0"><p className="question-wrap text-sm text-[#c9dad6]">{market.question}</p><p className="mt-1 text-xs text-[#7f9994]">{market.resolutionSourceName ?? "No official source recorded"} · ambiguity {Number(market.ambiguityScore ?? 1).toFixed(2)}</p></div><StatusChip value={market.resolutionStatus === "verified" && market.resolutionSourceUrl ? "ready" : "review"} /></div>)}</div></div>
      <div className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Agent governance" title="Worker → Manager review" description="The Worker gathers and normalizes evidence. The Manager challenges assumptions. Neither agent can directly submit an order." /><div className="space-y-3"><StateTile icon={Database} label="Worker / Luna Medium" value="Evidence collection" detail="Read-only sources, base rates and deterministic calculations" tone="good" /><StateTile icon={Sparkles} label="Manager / Luna Max" value="Challenge and decision" detail="Contradictions, uncertainty, strongest reason not to trade" tone="good" /><StateTile icon={ShieldCheck} label="Final gate" value="Human approval + risk checks" detail="Quotes, permissions, capital and kill switch rechecked before execution" tone="good" /></div></div>
    </section>
    <section className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Benchmark vault" title="Stored evidence and reproducibility" description="The application retains timestamped market, forecast, order, portfolio, agent and audit records in D1 so future results can be compared with the exact decision context." /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><MiniData label="Market snapshots" value={size(diagnostics.lineage?.marketSnapshots)} /><MiniData label="Forecast snapshots" value={size(diagnostics.lineage?.forecastSnapshots)} /><MiniData label="Audit events" value={size(diagnostics.lineage?.auditEvents)} /><MiniData label="Brier score" value={state.forecastAnalytics?.brierScore == null ? "—" : Number(state.forecastAnalytics.brierScore).toFixed(3)} /><MiniData label="Calibration error" value={diagnostics.calibration?.expectedCalibrationError == null ? "—" : Number(diagnostics.calibration.expectedCalibrationError).toFixed(3)} /></div><p className="mt-4 text-xs leading-5 text-[#78928d]">{String(diagnostics.policy ?? "Benchmark metrics require sufficient timestamped data and should not be interpreted as guaranteed future performance.")}</p></section>
    <section className="grid min-w-0 gap-4 xl:grid-cols-2">
      <div className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Forecast lab" title="Calibration and abstention" description="Low-confidence forecasts remain research-only. Scores are calculated only after a recorded resolution." /><div className="grid gap-3 sm:grid-cols-3"><MiniData label="Brier" value={state.forecastAnalytics?.brierScore == null ? "—" : Number(state.forecastAnalytics.brierScore).toFixed(3)} /><MiniData label="Abstained" value={String(diagnostics.abstention?.abstained ?? 0)} /><MiniData label="Actionable" value={String(diagnostics.abstention?.actionable ?? 0)} /></div><div className="mt-4 space-y-2">{(diagnostics.edgeMap ?? []).slice(0, 5).map((row: AnyRow) => <div key={String(row.segment)} className="surface-muted flex justify-between gap-3 p-3 text-xs"><span className="text-[#b6cac4]">{row.segment}</span><span className="mono text-[#a9dfbf]">edge {percent(row.meanEdge)} · Brier {row.brierScore == null ? "—" : Number(row.brierScore).toFixed(3)}</span></div>)}</div></div>
      <div className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Execution reality" title="Fill and attribution" description="Paper execution exposes available size, partial fills and remaining quantity instead of assuming every limit order fills instantly." /><div className="grid gap-3 sm:grid-cols-3"><MiniData label="Filled orders" value={String(diagnostics.execution?.filledOrders ?? 0)} /><MiniData label="Fill rate" value={diagnostics.execution?.fillRate == null ? "—" : percent(diagnostics.execution.fillRate)} /><MiniData label="Attributions" value={String((diagnostics.attribution ?? []).length)} /></div><div className="mt-4 space-y-2">{(diagnostics.fillSimulations ?? []).slice(0, 4).map((row: AnyRow, index: number) => <div key={index} className="surface-muted flex justify-between gap-3 p-3 text-xs"><span className="text-[#b6cac4]">Simulation {index + 1}</span><span className="mono text-[#a9dfbf]">{row.status} · {size(row.filled)} / {size(row.requested)}</span></div>)}{!(diagnostics.fillSimulations ?? []).length ? <p className="text-xs text-[#78928d]">No order-book replay records yet.</p> : null}</div></div>
    </section>
    <section className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Dependency and risk map" title="Correlated exposure warnings" description="Only explicitly verified relationships are shown. Provider grouping is not treated as proof of event correlation." />{(diagnostics.correlationWarnings ?? []).length ? <div className="space-y-2">{diagnostics.correlationWarnings.map((row: AnyRow, index: number) => <div key={index} className="surface-muted border border-[#d39a67]/30 p-3 text-sm text-[#e8c59a]">{String(row.relationship)} · combined exposure {money(row.combinedExposure)}</div>)}</div> : <p className="text-sm text-[#8da6a1]">No verified correlation-cap breaches recorded.</p>}</section>
  </div>;
}

function StateTile({ icon: Icon, label, value, detail, tone }: { icon: typeof Activity; label: string; value: string; detail: string; tone?: "good" | "warn" | "bad" }) {
  return <div className="surface-muted flex min-w-0 items-start gap-3 p-3.5"><div className="mt-0.5 rounded-lg border border-[#2d4b4c] bg-[#17302f] p-2"><Icon className="size-4 text-[#9fdcc0]" /></div><div className="min-w-0"><p className="metric-caption">{label}</p><div className="mt-1 flex items-center gap-2"><span className={`status-dot ${tone ?? ""}`} /><span className="truncate text-sm font-medium text-[#d6e6e1]">{value}</span></div><p className="mt-1 text-xs leading-5 text-[#7f9995]">{detail}</p></div></div>;
}

function ProgressLine({ label, value, max, display, warn = false }: { label: string; value: number; max: number; display: string; warn?: boolean }) {
  const ratio = Math.min(100, Math.max(0, max > 0 ? value / max * 100 : 0));
  return <div><div className="mb-2 flex justify-between gap-3 text-xs"><span className="text-[#8ea5a1]">{label}</span><span className="mono text-[#b8cbc6]">{display}</span></div><div className="bar-track"><div className={`bar-fill ${warn ? "warn" : ""}`} style={{ width: `${ratio}%` }} /></div></div>;
}

function Markets({ markets, watchlist, bridgeConfigured, onSyncCatalog, syncLoading, onResearch, onToggleWatchlist, onOpenResearch }: { markets: Market[]; watchlist: string[]; bridgeConfigured: boolean; onSyncCatalog: () => void; syncLoading: boolean; onResearch: (market: Market) => void; onToggleWatchlist: (marketId: string) => void; onOpenResearch: (market: Market) => void }) {
  return <div className="data-grid"><section className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Discovery" title="Event markets" description="Only contracts reported as permission-eligible by the bridge should become tradable. Demo rows remain paper-only and cannot be sent to IBKR." action={<div className="flex flex-wrap items-center justify-end gap-2"><StatusChip value={`${markets.length} markets`} /><Button variant="outline" size="sm" onClick={onSyncCatalog} disabled={!bridgeConfigured || syncLoading} title={bridgeConfigured ? "Queue a bridge catalog sync" : "Configure the bridge token first"}>{syncLoading ? <RefreshCw className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}Sync bridge catalog</Button></div>} />
    <div className="hidden md:block"><Table className="compact-table"><TableHeader><TableRow><TableHead>Question</TableHead><TableHead>YES / book</TableHead><TableHead>NO / book</TableHead><TableHead>Implied</TableHead><TableHead>Expiry</TableHead><TableHead>State</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader><TableBody>{markets.map((market) => <TableRow key={market.id}><TableCell className="question-wrap"><div className="font-medium text-[#d4e4df]">{market.question}</div><div className="mt-1 text-xs text-[#79918e]">{market.provider} · {market.exchange} · {market.dataOrigin === "demo" ? "Illustrative paper data" : "Bridge reported"}</div></TableCell><TableCell><span className="price-pill">{price(market.yes?.price)}</span><div className="mt-1 mono text-[0.68rem] text-[#718a87]">bid {price(market.yes?.bid)} · ask {price(market.yes?.ask)}</div><div className="mono text-[0.68rem] text-[#718a87]">sizes {size(market.yes?.bidSize)} / {size(market.yes?.askSize)} · {market.yes?.quoteFresh ? "fresh" : "stale"}</div></TableCell><TableCell><span className="price-pill no">{price(market.no?.price)}</span><div className="mt-1 mono text-[0.68rem] text-[#718a87]">bid {price(market.no?.bid)} · ask {price(market.no?.ask)}</div><div className="mono text-[0.68rem] text-[#718a87]">sizes {size(market.no?.bidSize)} / {size(market.no?.askSize)} · {market.no?.quoteFresh ? "fresh" : "stale"}</div></TableCell><TableCell><span className="mono text-sm text-[#c5d8d2]">{percent(market.yes?.price)}</span></TableCell><TableCell><span className="text-xs text-[#b5c9c4]">{dateTime(market.expiration)}</span></TableCell><TableCell><MarketState market={market} /></TableCell><TableCell><div className="flex items-center justify-end gap-1"><Button variant="ghost" size="sm" onClick={() => onToggleWatchlist(market.id)} aria-label={watchlist.includes(market.id) ? "Remove from watchlist" : "Add to watchlist"} title={watchlist.includes(market.id) ? "Remove from watchlist" : "Add to watchlist"} className={watchlist.includes(market.id) ? "text-[#f4d38d]" : "text-[#718b88]"}><Star className={`size-3.5 ${watchlist.includes(market.id) ? "fill-current" : ""}`} /></Button><Button variant="ghost" size="sm" onClick={() => onOpenResearch(market)} className="text-[#9fdcc0]">Research</Button><Button variant="outline" size="sm" onClick={() => onResearch(market)} disabled={!market.yes} title="Run research"><Sparkles className="size-3.5" />Analyse</Button></div></TableCell></TableRow>)}</TableBody></Table></div>
    <div className="space-y-3 md:hidden">{markets.map((market) => <div key={market.id} className="surface-muted min-w-0 p-4"><div className="flex items-start justify-between gap-3"><p className="question-wrap text-sm font-medium leading-5 text-[#d4e4df]">{market.question}</p><MarketState market={market} /></div><p className="mt-2 text-xs text-[#7c9691]">{market.provider} · {market.exchange} · expires {dateTime(market.expiration)}</p><div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-lg border border-[#274343] bg-[#102223] p-2.5"><p className="metric-caption">YES / implied</p><p className="mt-1 mono text-[#c7f0da]">{price(market.yes?.price)} <span className="text-xs text-[#83aaa0]">{percent(market.yes?.price)}</span></p><p className="mt-1 text-[0.68rem] text-[#718a87]">bid {price(market.yes?.bid)} · ask {price(market.yes?.ask)}</p><p className="mono text-[0.68rem] text-[#718a87]">size {size(market.yes?.askSize)}</p></div><div className="rounded-lg border border-[#26404d] bg-[#102126] p-2.5"><p className="metric-caption">NO</p><p className="mt-1 mono text-[#c7e5fa]">{price(market.no?.price)}</p><p className="mt-1 text-[0.68rem] text-[#718a87]">bid {price(market.no?.bid)} · ask {price(market.no?.ask)}</p><p className="mono text-[0.68rem] text-[#718a87]">size {size(market.no?.askSize)}</p></div></div><div className="mt-3 flex gap-2"><Button variant="ghost" size="sm" className={watchlist.includes(market.id) ? "h-9 w-9 px-0 text-[#f4d38d]" : "h-9 w-9 px-0 text-[#718b88]"} onClick={() => onToggleWatchlist(market.id)} aria-label={watchlist.includes(market.id) ? "Remove from watchlist" : "Add to watchlist"} title={watchlist.includes(market.id) ? "Remove from watchlist" : "Add to watchlist"}><Star className={`size-3.5 ${watchlist.includes(market.id) ? "fill-current" : ""}`} /></Button><Button variant="outline" size="sm" className="flex-1" onClick={() => onOpenResearch(market)}>Open research</Button><Button size="sm" className="flex-1" onClick={() => onResearch(market)}><Sparkles className="size-3.5" />Analyse</Button></div></div>)}</div>
  </section><section className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Eligibility" title="What the state labels mean" /><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Legend tone="good" title="Eligible" text="Bridge confirmed the contract and permission." /><Legend tone="warn" title="Paper only" text="Illustrative or simulated data; never tradable." /><Legend tone="bad" title="Permission unavailable" text="Hidden from live execution." /><Legend tone="warn" title="Stale data" text="Quote freshness gate must pass again." /></div></section></div>;
}

function Legend({ tone, title, text }: { tone: "good" | "warn" | "bad"; title: string; text: string }) {
  return <div className="surface-muted p-3.5"><span className={`status-dot ${tone} mb-3 inline-block`} /><p className="text-sm font-medium text-[#cbdcd7]">{title}</p><p className="mt-1 text-xs leading-5 text-[#7f9894]">{text}</p></div>;
}

function ResearchPanel({ markets, selectedMarket, selectedMarketId, setSelectedMarketId, research, loading, onRun }: { markets: Market[]; selectedMarket?: Market; selectedMarketId: string; setSelectedMarketId: (value: string) => void; research: ResearchResult | null; loading: boolean; onRun: () => void }) {
  return <div className="data-grid"><section className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Evidence desk" title="Research" description="The engine separates market-implied probability from an analyst estimate. Evidence publication timestamps and uncertainty stay attached to the result." action={<div className="flex items-center gap-2"><Select value={selectedMarketId} onValueChange={setSelectedMarketId}><SelectTrigger className="w-[13.5rem] border-[#385053] text-xs sm:w-[19rem]"><SelectValue placeholder="Choose a market" /></SelectTrigger><SelectContent>{markets.map((market) => <SelectItem key={market.id} value={market.id}>{market.question}</SelectItem>)}</SelectContent></Select><Button onClick={onRun} disabled={loading || !selectedMarket?.yes}>{loading ? <RefreshCw className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}{loading ? "Running" : "Run analysis"}</Button></div>} />
    {selectedMarket ? <div className="grid gap-4 xl:grid-cols-[1.05fr_.95fr]"><div className="surface-muted min-w-0 p-4 sm:p-5"><div className="flex flex-wrap items-center gap-2"><MarketState market={selectedMarket} /><span className="mono text-xs text-[#78918e]">{selectedMarket.provider} · {selectedMarket.exchange}</span></div><h3 className="mt-4 text-lg font-medium leading-7 tracking-[-0.02em] text-[#e0eeea]">{selectedMarket.question}</h3><div className="mt-5 grid grid-cols-2 gap-3"><ResearchMetric label="YES quote" value={price(selectedMarket.yes?.price)} detail={`implied ${percent(selectedMarket.yes?.price)}`} /><ResearchMetric label="NO quote" value={price(selectedMarket.no?.price)} detail={`implied ${percent(selectedMarket.no?.price)}`} /></div><div className="mt-5 border-t border-[#263d3e] pt-4"><p className="metric-caption">Resolution criteria</p><p className="mt-2 text-sm leading-6 text-[#aec1bc]">{selectedMarket.resolutionCriteria || "Not supplied by the provider."}</p><p className="mt-3 text-xs text-[#78918e]">Expected resolution {dateTime(selectedMarket.expiration)} · quote {selectedMarket.yes?.quoteFresh ? "fresh" : "stale"}</p></div></div><div className="surface-muted min-w-0 p-4 sm:p-5">{research ? <ResearchResultCard result={research} /> : <EmptyState icon={FileCheck2} title="No run selected" description="Choose a market and run the deterministic baseline or configured structured analysis." />}</div></div> : <EmptyState icon={BookOpen} title="No market selected" description="The bridge or paper catalog has not supplied an event contract." />}
  </section>{research ? <section className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Source boundary" title="Evidence and uncertainty" /><div className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]"><div className="space-y-3">{research.estimate.evidence.map((evidence) => <a key={`${evidence.url}-${evidence.title}`} href={evidence.url} target="_blank" rel="noreferrer" className="surface-muted block p-3.5 transition-colors hover:border-[#4e7770]"><div className="flex items-start gap-3"><BookOpen className="mt-0.5 size-4 shrink-0 text-[#9fdcc0]" /><div className="min-w-0"><p className="text-sm font-medium text-[#cfe1db]">{evidence.title}</p><p className="mt-1 truncate text-xs text-[#82a09a]">{evidence.url}</p><p className="mt-2 mono text-[0.68rem] text-[#6f8a86]">Published {dateTime(evidence.publishedAt)}</p></div></div></a>)}</div><div className="surface-muted p-4"><p className="metric-caption">Uncertainties</p><ul className="mt-3 space-y-2 text-sm leading-6 text-[#a9beb9]">{research.estimate.uncertainties.map((uncertainty) => <li key={uncertainty} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-[#efbd72]" />{uncertainty}</li>)}</ul></div></div></section> : null}</div>;
}

function ResearchMetric({ label, value, detail }: { label: string; value: string; detail: string }) { return <div className="rounded-lg border border-[#294343] bg-[#102223] p-3"><p className="metric-caption">{label}</p><p className="mt-2 mono text-xl text-[#d3e9e2]">{value}</p><p className="mt-1 text-xs text-[#7e9a95]">{detail}</p></div>; }

function ResearchResultCard({ result }: { result: ResearchResult }) {
  const estimate = result.estimate.estimated_probability;
  const selected = result.comparison.selectedOutcome;
  const scenarios = Array.isArray(result.comparison.scenarios) ? result.comparison.scenarios : [];
  return <div><div className="flex items-center justify-between gap-3"><p className="metric-caption">{result.estimate.provider === "openai" ? "Structured estimate" : "Deterministic baseline"}</p><StatusChip value={result.proposal ? "Proposal ready" : "No proposal"} tone={result.proposal ? "good" : "warn"} /></div><div className="mt-5 flex items-end justify-between gap-3"><div><p className="metric-caption">Analyst probability</p><p className="mt-2 metric-number">{percent(estimate)}</p></div><div className="text-right"><p className="metric-caption">Confidence</p><p className="mt-2 mono text-xl text-[#cce8dc]">{percent(result.estimate.confidence)}</p></div></div><div className="mt-5"><ProgressLine label="Estimate vs market" value={estimate} max={1} display={`${selected} edge ${percent(result.comparison[selected.toLowerCase()]?.netEdge ?? 0)}`} /></div><p className="mt-5 text-sm leading-6 text-[#acc1bb]">{result.estimate.reasoning_summary}</p><div className="mt-4 grid grid-cols-2 gap-3"><div><p className="metric-caption">YES net edge</p><p className="mt-1 mono text-[#bfe8d1]">{percent(result.comparison.yes?.netEdge ?? 0)}</p></div><div><p className="metric-caption">NO net edge</p><p className="mt-1 mono text-[#c7e5fa]">{percent(result.comparison.no?.netEdge ?? 0)}</p></div></div><div className="mt-4 grid grid-cols-2 gap-3"><div className="surface-muted p-3"><p className="metric-caption">Opportunity rank</p><p className="mt-1 metric-number">{result.comparison.opportunityRank ?? "—"}<span className="ml-1 text-xs text-[#7f9994]">/100</span></p></div><div className="surface-muted p-3"><p className="metric-caption">Sizing method</p><p className="mt-1 text-sm text-[#c9ddd5]">Quarter-Kelly capped</p><p className="mt-1 text-xs text-[#7f9994]">Quantity {result.comparison.positionSizing?.quantity ?? "—"}</p></div></div>{scenarios.length ? <div className="mt-4 rounded-lg border border-[#294343] bg-[#102223] p-3"><p className="metric-caption">Scenario analysis</p><div className="mt-3 grid gap-2 sm:grid-cols-3">{scenarios.map((scenario: AnyRow) => <div key={String(scenario.name)} className="rounded-md border border-[#294343] p-2.5"><p className="text-xs text-[#8da6a1]">{scenario.name}</p><p className="mt-1 mono text-sm text-[#d1e6df]">{percent(scenario.probability)}</p><p className={`mt-1 mono text-xs ${Number(scenario.expectedPnl) >= 0 ? "text-[#a9e2c3]" : "text-[#efa0a0]"}`}>{money(scenario.expectedPnl)} expected</p></div>)}</div></div> : null}</div>;
}

function Proposals({ proposals, onAction, onReplay, actionLoading }: { proposals: Proposal[]; onAction: (proposal: Proposal, action: "approve" | "reject" | "cancel") => void; onReplay: (proposal: Proposal) => void; actionLoading: string | null }) {
  return <div className="data-grid"><section className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Human gate" title="Trade proposals" description="Approval is an explicit action. The Site never lets an LLM create an executable order and the bridge rechecks the same limits locally." action={<StatusChip value={`${proposals.filter((p) => p.status === "pending").length} pending`} />} />{proposals.length ? <div className="space-y-3">{proposals.map((proposal) => <ProposalCard key={String(proposal.id)} proposal={proposal} onAction={onAction} onReplay={onReplay} actionLoading={actionLoading} />)}</div> : <EmptyState icon={ClipboardCheck} title="Proposal queue is empty" description="Run research from Event markets to create a proposal only when edge, confidence, quote freshness and risk checks pass." />}</section></div>;
}

function ProposalCompact({ proposal, onAction, actionLoading }: { proposal: Proposal; onAction: (proposal: Proposal, action: "approve" | "reject" | "cancel") => void; actionLoading: string | null }) {
  return <div className="surface-muted min-w-0 p-3.5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="question-wrap text-sm font-medium leading-5 text-[#d2e2dd]">{proposal.question ?? proposal.contract_id}</p><p className="mt-1 text-xs text-[#7f9994]">{proposal.outcome} · {proposal.direction} · expires {dateTime(proposal.expires_at)}</p></div><StatusChip value={String(proposal.status)} /></div><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3 text-xs"><span className="mono text-[#c2d8d1]">{price(proposal.current_quote)}</span><span className="text-[#8da7a1]">edge <span className="text-[#bfe8d1]">{percent(proposal.net_edge)}</span></span><span className="text-[#8da7a1]">conf <span className="text-[#d4c494]">{percent(proposal.confidence)}</span></span></div>{proposal.status === "pending" ? <div className="flex gap-2"><Button size="sm" onClick={() => onAction(proposal, "approve")} disabled={actionLoading === `approve:${proposal.id}`}><Check className="size-3.5" />Approve</Button><Button variant="ghost" size="sm" onClick={() => onAction(proposal, "reject")} disabled={actionLoading === `reject:${proposal.id}`} className="text-[#efaaaa]">Reject</Button></div> : null}</div></div>;
}

function ProposalCard({ proposal, onAction, onReplay, actionLoading }: { proposal: Proposal; onAction: (proposal: Proposal, action: "approve" | "reject" | "cancel") => void; onReplay: (proposal: Proposal) => void; actionLoading: string | null }) {
  const checks = Array.isArray(proposal.riskChecks) ? proposal.riskChecks : [];
  const evidence = Array.isArray(proposal.evidence) ? proposal.evidence : [];
  return <div className="surface-muted min-w-0 p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><StatusChip value={String(proposal.status)} /><span className="mono text-xs text-[#75908b]">{String(proposal.id).slice(0, 24)}</span></div><h3 className="mt-3 question-wrap text-base font-medium leading-6 text-[#dcebe6]">{proposal.question ?? proposal.contract_id}</h3><p className="mt-1 text-xs text-[#7d9691]">{proposal.provider ?? "IBKR"} · {proposal.exchange ?? "—"} · {proposal.outcome} · {proposal.direction}</p></div><div className="text-right"><p className="metric-caption">Notional</p><p className="mt-1 mono text-lg text-[#d6e8e1]">{money(proposal.notional_value)}</p><p className="mt-1 text-xs text-[#7d9691]">expires {dateTime(proposal.expires_at)}</p></div></div><div className="mt-5 grid gap-3 sm:grid-cols-4"><ProposalMetric label="Quote" value={price(proposal.current_quote)} /><ProposalMetric label="Estimate" value={percent(proposal.estimated_probability)} /><ProposalMetric label="Net edge" value={percent(proposal.net_edge)} accent /><ProposalMetric label="Max entry" value={price(proposal.max_entry_price)} /></div><div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto]"><div><p className="metric-caption">Evidence</p><div className="mt-2 space-y-1.5 text-xs text-[#9bb2ad]">{evidence.length ? evidence.slice(0, 3).map((item: AnyRow) => <a key={`${item.url}-${item.title}`} href={String(item.url)} target="_blank" rel="noreferrer" className="block truncate hover:text-[#c8ead8]">{String(item.title)} · {dateTime(item.publishedAt ?? item.published_at)}</a>) : <span>No evidence attached</span>}</div><p className="mt-4 metric-caption">Risk-check results</p><div className="mt-2 flex flex-wrap gap-2">{checks.length ? checks.map((check: AnyRow) => <span key={String(check.key)} className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs ${check.pass ? "border-[#9fe3c2]/25 bg-[#9fe3c2]/8 text-[#b9e8cd]" : "border-[#ef8e8e]/30 bg-[#ef8e8e]/8 text-[#f0aaaa]"}`}><span className={`size-1.5 rounded-full ${check.pass ? "bg-[#9fe3c2]" : "bg-[#ef8e8e]"}`} />{check.label}</span>) : <span className="text-sm text-[#849e99]">Not available</span>}</div></div><div className="flex flex-wrap items-end justify-start gap-2 lg:justify-end">{proposal.status === "pending" ? <><Button onClick={() => onAction(proposal, "approve")} disabled={actionLoading === `approve:${proposal.id}`}><Check className="size-3.5" />Approve</Button><Button variant="outline" onClick={() => onAction(proposal, "reject")} disabled={actionLoading === `reject:${proposal.id}`} className="text-[#efaaaa]">Reject</Button><Button variant="ghost" onClick={() => onAction(proposal, "cancel")} disabled={actionLoading === `cancel:${proposal.id}`}>Cancel</Button></> : <Button variant="outline" size="sm" onClick={() => onReplay(proposal)} disabled={actionLoading === `replay:${proposal.id}`}><RefreshCw className="size-3.5" />Replay in paper</Button>}</div></div></div>;
}

function ProposalMetric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) { return <div className="rounded-lg border border-[#294343] bg-[#102223] p-3"><p className="metric-caption">{label}</p><p className={`mt-2 mono text-lg ${accent ? "text-[#bfe8d1]" : "text-[#d1e2dc]"}`}>{value}</p></div>; }

function Portfolio({ portfolio, proposals, onReset, onExport, onResolve, onReplay, actionLoading }: { portfolio: Portfolio; proposals: Proposal[]; onReset: () => void; onExport: () => void; onResolve: (position: AnyRow) => void; onReplay: (proposal: Proposal) => void; actionLoading: string | null }) {
  return <div className="data-grid"><section className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Simulation" title="Paper portfolio" description="These values are simulated and persist in D1. No IBKR account is required for the paper lifecycle." action={<div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={onExport}><FileText className="size-3.5" />Export history</Button><Button variant="outline" size="sm" onClick={onReset} disabled={actionLoading === "reset"}><RefreshCw className="size-3.5" />Reset</Button></div>} /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Cash" value={money(portfolio.cash)} detail="Simulated available balance" icon={CircleDollarSign} /><MetricCard label="Portfolio value" value={money(portfolio.portfolioValue)} detail="Cash plus marked positions" icon={WalletCards} /><MetricCard label="Unrealised P&L" value={money(portfolio.unrealisedPnl)} detail="Current mark versus cost" icon={LineChart} tone={portfolio.unrealisedPnl >= 0 ? "positive" : "negative"} /><MetricCard label="Total return" value={`${portfolio.totalReturn >= 0 ? "+" : ""}${money(portfolio.totalReturn)}`} detail={percent(portfolio.totalReturnPercent)} icon={portfolio.totalReturn >= 0 ? TrendingUp : TrendingDown} tone={portfolio.totalReturn >= 0 ? "positive" : "negative"} /></div></section><section className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Positions" title="Open contracts" /><div className="hidden md:block"><Table className="compact-table"><TableHeader><TableRow><TableHead>Contract</TableHead><TableHead>Qty</TableHead><TableHead>Avg entry</TableHead><TableHead>Mark</TableHead><TableHead>Cost</TableHead><TableHead>P&L</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader><TableBody>{portfolio.positions.map((position) => <TableRow key={String(position.id)}><TableCell className="question-wrap"><span className="font-medium text-[#d3e4de]">{position.question ?? position.contract_id}</span><span className="mt-1 block text-xs text-[#7c9591]">{position.outcome} · {position.exchange ?? "—"}</span></TableCell><TableCell className="mono">{position.quantity}</TableCell><TableCell className="mono">{price(position.average_entry_price)}</TableCell><TableCell className="mono">{price(position.mark_price)}</TableCell><TableCell className="mono">{money(position.cost_basis)}</TableCell><TableCell className={`mono ${Number(position.unrealised_pnl) >= 0 ? "text-[#bfe8d1]" : "text-[#efa0a0]"}`}>{money(position.unrealised_pnl)}</TableCell><TableCell><Button variant="ghost" size="sm" onClick={() => onResolve(position)} disabled={actionLoading === `resolve:${position.contract_id}`}>Resolve</Button></TableCell></TableRow>)}</TableBody></Table></div><div className="space-y-3 md:hidden">{portfolio.positions.map((position) => <div key={String(position.id)} className="surface-muted p-4"><p className="question-wrap text-sm font-medium leading-5 text-[#d4e4df]">{position.question ?? position.contract_id}</p><p className="mt-1 text-xs text-[#7c9591]">{position.outcome} · {position.quantity} contracts</p><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><MiniData label="Avg entry" value={price(position.average_entry_price)} /><MiniData label="Mark" value={price(position.mark_price)} /><MiniData label="Cost" value={money(position.cost_basis)} /><MiniData label="P&L" value={money(position.unrealised_pnl)} /></div><Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => onResolve(position)}>Simulate resolution</Button></div>)}{!portfolio.positions.length ? <EmptyState icon={WalletCards} title="No open positions" description="Approve a paper proposal to create a simulated fill and position." /> : null}</div></section><section className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="History" title="Trade history" /><div className="scroll-region"><Table className="compact-table"><TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Contract</TableHead><TableHead>Status</TableHead><TableHead>Qty</TableHead><TableHead>Limit</TableHead><TableHead>Mode</TableHead><TableHead>Time</TableHead></TableRow></TableHeader><TableBody>{portfolio.tradeHistory.map((order) => <TableRow key={String(order.id)}><TableCell className="mono text-xs">{String(order.id).slice(0, 18)}</TableCell><TableCell className="question-wrap">{order.question ?? order.contract_id}</TableCell><TableCell><StatusChip value={String(order.status)} /></TableCell><TableCell className="mono">{order.quantity}</TableCell><TableCell className="mono">{price(order.limit_price)}</TableCell><TableCell><StatusChip value={String(order.mode)} tone="good" /></TableCell><TableCell className="text-xs">{dateTime(order.created_at)}</TableCell></TableRow>)}</TableBody></Table></div>{!portfolio.tradeHistory.length ? <div className="mt-3"><EmptyState icon={ScrollText} title="No trades recorded" description="Paper fills will appear here with their order and audit trail." /></div> : null}</section><section className="grid min-w-0 gap-4 lg:grid-cols-2"><div className="surface min-w-0 p-5"><SectionHeading eyebrow="Resolved" title="Resolved positions" />{portfolio.resolvedPositions.length ? <div className="space-y-2">{portfolio.resolvedPositions.map((position) => <div key={String(position.id)} className="surface-muted flex items-center justify-between gap-3 p-3"><span className="question-wrap text-sm text-[#c6d8d2]">{position.question ?? position.contract_id}</span><span className="mono text-xs">{money(position.realised_pnl)}</span></div>)}</div> : <EmptyState icon={CheckCircle2} title="Nothing resolved" description="Use Simulate resolution on an open position when testing settlement behavior." />}</div><div className="surface min-w-0 p-5"><SectionHeading eyebrow="Replay" title="Historical proposal" description="Replay keeps the original source proposal intact and creates a new paper queue item." />{proposals.length ? <div className="space-y-2">{proposals.slice(0, 3).map((proposal) => <div key={String(proposal.id)} className="surface-muted flex items-center justify-between gap-3 p-3"><span className="question-wrap text-sm text-[#c6d8d2]">{proposal.question ?? proposal.contract_id}</span><Button variant="ghost" size="sm" onClick={() => onReplay(proposal)} disabled={actionLoading === `replay:${proposal.id}`}>Replay</Button></div>)}</div> : <EmptyState icon={RefreshCw} title="No proposal history" description="Approved or rejected proposals will be replayable here." />}</div></section></div>;
}

function MiniData({ label, value }: { label: string; value: string }) { return <div className="rounded-md border border-[#294343] bg-[#102223] p-2"><span className="metric-caption">{label}</span><span className="mt-1 block mono text-[#cbded7]">{value}</span></div>; }

function RiskPanel({ state, onToggleKillSwitch, actionLoading }: { state: DashboardState; onToggleKillSwitch: () => void; actionLoading: string | null }) {
  const risk = state.risk;
  return <div className="data-grid"><section className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Guardrails" title="Risk" description="The Site and bridge are expected to enforce the same limits. A missing quote, permission or heartbeat must halt live execution." action={<StatusChip value={state.killSwitch ? "Kill switch active" : risk.tradingHalted ? "Trading halted" : "Risk checks clear"} tone={state.killSwitch || risk.tradingHalted ? "bad" : "good"} />} /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Aggregate exposure" value={money(risk.aggregateExposure)} detail={`Cap ${money(risk.settings.maxTotalExposureUsd ?? 250)}`} icon={BarChart3} tone={risk.aggregateExposure > (risk.settings.maxTotalExposureUsd ?? 250) ? "negative" : "neutral"} /><MetricCard label="Available balance" value={money(risk.availableBalance)} detail="Paper cash / bridge account when connected" icon={CircleDollarSign} /><MetricCard label="Daily P&L" value={money(risk.dailyPnl)} detail={`Loss limit ${money(risk.settings.maxDailyLossUsd ?? 30)}`} icon={risk.dailyPnl >= 0 ? TrendingUp : TrendingDown} tone={risk.dailyPnl >= 0 ? "positive" : "negative"} /><MetricCard label="Concentration" value={percent(risk.concentration)} detail="Open exposure / portfolio value" icon={Layers3} tone={risk.concentration > 0.5 ? "warning" : "neutral"} /></div></section><div className="grid min-w-0 gap-4 lg:grid-cols-[1fr_.8fr]"><section className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Limits" title="Exposure map" /><div className="space-y-4">{risk.exposureByContract.length ? risk.exposureByContract.map((row) => <div key={String(row.contractId)}><div className="mb-2 flex items-start justify-between gap-3 text-sm"><span className="question-wrap text-[#c8d9d4]">{row.question}</span><span className="mono text-[#bcd8cc]">{money(row.exposure)}</span></div><ProgressLine label="" value={row.exposure} max={risk.settings.maxPositionPerContractUsd ?? 50} display={`cap ${money(risk.settings.maxPositionPerContractUsd ?? 50)}`} /></div>) : <EmptyState icon={BarChart3} title="No exposure" description="Open paper positions will appear with per-contract caps." />}</div></section><section className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Intervention" title="Kill switch" /><div className={`rounded-lg border p-4 ${state.killSwitch ? "border-[#ef8e8e]/35 bg-[#4f2525]/20" : "border-[#9fe3c2]/20 bg-[#17302a]/30"}`}><div className="flex items-start gap-3">{state.killSwitch ? <XCircle className="mt-0.5 size-5 text-[#efaaaa]" /> : <ShieldCheck className="mt-0.5 size-5 text-[#a9e6c5]" />}<div><p className="font-medium text-[#d9e9e4]">{state.killSwitch ? "New activity stopped" : "System available"}</p><p className="mt-1 text-sm leading-6 text-[#91aaa4]">{state.killSwitch ? "Pending proposals and bridge commands are cancelled. The bridge will remain read-only." : "Activating this stops new proposals and live commands, then asks the bridge to cancel active live orders."}</p></div></div><Button className="mt-4 w-full" variant={state.killSwitch ? "outline" : "destructive"} onClick={() => void onToggleKillSwitch()} disabled={actionLoading === "kill-switch"}>{state.killSwitch ? "Clear kill switch" : "Activate kill switch"}</Button></div><div className="mt-4 space-y-2 text-xs text-[#849d98]"><div className="flex justify-between gap-3"><span>Account floor</span><span className="mono">{money(risk.accountFloor)}</span></div><div className="flex justify-between gap-3"><span>Max order</span><span className="mono">{money(risk.settings.maxOrderSizeUsd ?? 20)}</span></div><div className="flex justify-between gap-3"><span>Quote slippage estimate</span><span className="mono">{percent(risk.slippageEstimate)}</span></div></div></section></div>{risk.breaches.length ? <section className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Events" title="Risk breaches" /> <div className="space-y-2">{risk.breaches.map((breach) => <div key={breach.message} className="flex items-start gap-3 rounded-lg border border-[#ef8e8e]/25 bg-[#4f2525]/15 p-3 text-sm text-[#f0aaaa]"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{breach.message}</div>)}</div></section> : null}</div>;
}

function DeepResearchPanel({ snapshot, onLoad, onCreateProposal }: { snapshot: StockSnapshot | null; onLoad: (ticker: string) => Promise<StockSnapshot>; onCreateProposal: (ticker: string, quantity: number) => Promise<void> }) {
  const [ticker, setTicker] = useState("AAPL");
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [brief, setBrief] = useState<AnyRow | null>(null);
  const [competitors, setCompetitors] = useState<StockSnapshot[]>([]);
  const [quantity, setQuantity] = useState("1");
  const [proposalLoading, setProposalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function load() {
    setLoading(true); setError(null);
    try { await onLoad(ticker); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Ticker data could not be loaded."); }
    finally { setLoading(false); }
  }
  async function generateBrief() {
    if (!snapshot) return;
    setAiLoading(true); setError(null);
    try {
      const response = await apiRequest<{ research: AnyRow }>("/api/research", { method: "POST", body: JSON.stringify({ ticker: snapshot.ticker }) });
      setBrief(response.research);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Research brief could not be generated."); }
    finally { setAiLoading(false); }
  }
  async function loadCompetitors() {
    if (!snapshot) return;
    try {
      const response = await apiRequest<{ competitors: StockSnapshot[] }>("/api/competitors", { method: "POST", body: JSON.stringify({ tickers: [] }) });
      setCompetitors(response.competitors ?? []);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Competitors could not be loaded."); }
  }
  async function createProposal() {
    const shares = Number(quantity);
    if (!snapshot || !Number.isFinite(shares) || shares <= 0) { setError("Enter a positive share quantity."); return; }
    setProposalLoading(true); setError(null);
    try { await onCreateProposal(snapshot.ticker, shares); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Paper proposal could not be created."); } finally { setProposalLoading(false); }
  }
  const change = snapshot?.changePercent ?? null;
  const range = snapshot?.high52 && snapshot.low52 && snapshot.price ? Math.max(0, Math.min(100, ((snapshot.price - snapshot.low52) / (snapshot.high52 - snapshot.low52)) * 100)) : 0;
  return <div className="data-grid deep-research-surface">
    <section className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Live fundamentals / yfinance" title="Deep research" description="Enter any ticker for a fresh snapshot, one-year history and a structured research brief. Data and AI commentary are informational, not financial advice." /><div className="flex flex-col gap-3 sm:flex-row"><div className="flex min-w-0 flex-1 items-center rounded-md border border-[#385053] bg-[#0d1b1d] px-3"><Search className="mr-2 size-4 text-[#86aaa2]" /><Input data-testid="deep-research-ticker" aria-label="Ticker symbol" value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} placeholder="Ticker, e.g. AAPL or SAP.DE" className="h-10 border-0 bg-transparent px-0 focus-visible:ring-0" /></div><Button data-testid="deep-research-load" onClick={() => void load()} disabled={loading || !ticker.trim()}>{loading ? <RefreshCw className="size-4 animate-spin" /> : <Search className="size-4" />}{loading ? "Loading" : "Load stock"}</Button></div>{error ? <p role="alert" className="mt-3 rounded-lg border border-[#ef8e8e]/30 bg-[#4f2525]/20 p-3 text-sm text-[#f0aaaa]">{error}</p> : null}</section>
    {!snapshot ? <section className="surface min-w-0 p-8"><EmptyState icon={Search} title="Search a company to begin" description="The Windows bridge can provide the same research through the real yfinance library; the Site also supports HTTP snapshots when no bridge is connected." /></section> : <>
      <section className="surface min-w-0 p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">Key data · {snapshot.ticker}</p><h2 className="section-title">{snapshot.name}</h2><p className="mt-1 text-sm text-[#8da4a1]">{snapshot.sector ?? "Sector unavailable"} · {snapshot.industry ?? "Industry unavailable"} · {snapshot.source}</p></div><div className="text-right"><p className="metric-number">{snapshot.price == null ? "—" : `${snapshot.currency} ${snapshot.price.toFixed(2)}`}</p><p className={`text-sm ${change != null && change >= 0 ? "text-[#a9e6c5]" : "text-[#f1a0a0]"}`}>{change == null ? "Change unavailable" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}% today`}</p></div></div><div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><MiniData label="Market cap" value={snapshot.marketCap == null ? "—" : money(snapshot.marketCap)} /><MiniData label="P/E" value={snapshot.pe == null ? "—" : snapshot.pe.toFixed(1)} /><MiniData label="Forward P/E" value={snapshot.forwardPe == null ? "—" : snapshot.forwardPe.toFixed(1)} /><MiniData label="Beta" value={snapshot.beta == null ? "—" : snapshot.beta.toFixed(2)} /></div><div className="mt-5"><div className="flex justify-between text-xs text-[#819b95]"><span>52-week low {snapshot.low52 ?? "—"}</span><span>52-week high {snapshot.high52 ?? "—"}</span></div><div className="relative mt-2 h-2 rounded-full bg-[#203235]"><span className="absolute inset-y-0 left-0 rounded-full bg-[#9fd5ee]" style={{ width: `${range}%` }} /><span className="absolute top-1/2 size-4 -translate-y-1/2 rounded-full border-2 border-[#d8f1ff] bg-[#2d6f83]" style={{ left: `calc(${range}% - 0.5rem)` }} /></div><p className="mt-2 text-xs text-[#78918e]">Market-cap scale: {snapshot.marketCap == null ? "unavailable" : snapshot.marketCap < 2e9 ? "Micro" : snapshot.marketCap < 10e9 ? "Small" : snapshot.marketCap < 50e9 ? "Mid" : snapshot.marketCap < 200e9 ? "Large" : "Mega"}</p></div></section>
      <section className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Paper execution" title={`Create a ${snapshot.ticker} proposal`} description="This creates a paper-only share order for your review. Approval uses the Paper execution target selected in Settings: IBKR TWS or the website simulator." /><div className="flex flex-col gap-3 sm:flex-row sm:items-end"><div className="w-full sm:max-w-xs"><label className="metric-caption" htmlFor="stock-proposal-quantity">Shares (fractional allowed)</label><Input id="stock-proposal-quantity" type="number" min="0.001" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-2" /></div><Button onClick={() => void createProposal()} disabled={proposalLoading || snapshot.price == null}>{proposalLoading ? "Creating…" : `Add ${snapshot.ticker} to proposals`}</Button></div><p className="mt-3 text-xs text-[#78918e]">Use fractional shares for higher-priced stocks. Real quote data is fetched from yfinance/Yahoo, then risk limits are checked again when you approve.</p></section>
      <section className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Price history" title="One-year chart" description="Daily closing prices supplied by yfinance-compatible market data." /><div className="h-64 w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={snapshot.history}><defs><linearGradient id="deepResearchFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#9fd5ee" stopOpacity={0.35} /><stop offset="95%" stopColor="#9fd5ee" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#294343" strokeDasharray="3 3" /><XAxis dataKey="date" minTickGap={36} tick={{ fill: "#78918e", fontSize: 11 }} /><YAxis domain={["auto", "auto"]} tick={{ fill: "#78918e", fontSize: 11 }} /><Tooltip contentStyle={{ background: "#102223", border: "1px solid #385053", color: "#d9e9e4" }} /><Area type="monotone" dataKey="close" stroke="#9fd5ee" fill="url(#deepResearchFill)" strokeWidth={2} /></AreaChart></ResponsiveContainer></div></section>
      <section className="surface min-w-0 p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><SectionHeading eyebrow="AI research brief" title="Context, valuation and risks" description="OpenAI analysis is generated only after you request it. It is clearly labelled as analysis and uses the Site-managed model configuration." /><Button data-testid="deep-research-generate" onClick={() => void generateBrief()} disabled={aiLoading}>{aiLoading ? "Analysing" : "Generate AI brief"}</Button></div><div className="grid gap-3 lg:grid-cols-3"><ResearchCard title="Context & catalysts" data={brief?.context_catalysts} /><ResearchCard title="Valuation & growth" data={brief?.valuation_growth} /><ResearchCard title="Competitors & risks" data={brief?.competitors_risks} /></div></section>
      <section className="surface min-w-0 p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><SectionHeading eyebrow="Peer comparison" title="Competitors" description="Provide tickers from the same business for a side-by-side comparison." /><Button variant="outline" data-testid="deep-research-competitors" onClick={() => void loadCompetitors()}>Load comparison</Button></div>{competitors.length ? <div className="scroll-region"><Table className="compact-table"><TableHeader><TableRow><TableHead>Company</TableHead><TableHead>Price</TableHead><TableHead>Market cap</TableHead><TableHead>P/E</TableHead><TableHead>EPS</TableHead><TableHead>Revenue growth</TableHead><TableHead>Margin</TableHead></TableRow></TableHeader><TableBody>{competitors.map((item) => <TableRow key={item.ticker}><TableCell>{item.name} <span className="mono text-xs text-[#78918e]">{item.ticker}</span></TableCell><TableCell>{item.price ?? "—"}</TableCell><TableCell>{item.marketCapUsd == null ? "—" : money(item.marketCapUsd)}</TableCell><TableCell>{item.pe ?? item.forwardPe ?? "—"}</TableCell><TableCell>{item.eps ?? "—"}</TableCell><TableCell>{item.revenueGrowth == null ? "—" : percent(item.revenueGrowth)}</TableCell><TableCell>{item.profitMargin == null ? "—" : percent(item.profitMargin)}</TableCell></TableRow>)}</TableBody></Table></div> : <p className="text-sm text-[#819b95]">No peer snapshots loaded yet.</p>}</section>
      <section className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Analyst view" title="Consensus" /><div className="grid gap-3 sm:grid-cols-4"><MiniData label="Buy" value={String(snapshot.analystBuy)} /><MiniData label="Hold" value={String(snapshot.analystHold)} /><MiniData label="Sell" value={String(snapshot.analystSell)} /><MiniData label="Mean target" value={snapshot.meanTarget == null ? "—" : `${snapshot.currency} ${snapshot.meanTarget.toFixed(2)}`} /></div><p className="mt-3 text-xs text-[#78918e]">Highest-vote label: {Math.max(snapshot.analystBuy, snapshot.analystHold, snapshot.analystSell) === snapshot.analystBuy ? "Buy" : Math.max(snapshot.analystHold, snapshot.analystSell) === snapshot.analystHold ? "Hold" : "Sell"}. Analyst ratings are not a recommendation.</p></section>
    </>}
  </div>;
}

function ResearchCard({ title, data }: { title: string; data: unknown }) { const record = data && typeof data === "object" ? data as AnyRow : null; return <div className="surface-muted min-w-0 p-4"><h3 className="font-medium text-[#d3e4de]">{title}</h3><p className="mt-2 text-sm leading-6 text-[#a9bfba]">{record ? String(record.summary ?? record.reasoning ?? "Analysis returned without a summary.") : "Generate the structured AI brief to populate this section."}</p>{record?.uncertainties ? <p className="mt-3 text-xs leading-5 text-[#efbd72]">Uncertainty: {Array.isArray(record.uncertainties) ? record.uncertainties.join(" ") : String(record.uncertainties)}</p> : null}</div>; }

function HelperPanel({ state, selectedMarket }: { state: DashboardState; selectedMarket?: Market }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; message: string; model?: string; created_at: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiRequest<{ history?: typeof messages }>("/api/helper").then((data) => setMessages(data.history ?? [])).catch(() => undefined);
  }, []);

  async function ask() {
    const question = input.trim();
    if (!question || loading) return;
    setInput("");
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{ history?: typeof messages }>("/api/helper", { method: "POST", body: JSON.stringify({ message: question, view: "dashboard", context: `Mode: ${state.mode}. Bridge: ${state.bridge?.state ?? "unknown"}. Selected market: ${selectedMarket?.question ?? "none"}.` }) });
      setMessages(data.history ?? []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Luna could not answer.");
    } finally { setLoading(false); }
  }

  async function clear() {
    if (!window.confirm("Clear the saved Luna helper conversation?")) return;
    const response = await fetch("/api/helper", { method: "DELETE" });
    if (response.ok) setMessages([]);
  }

  return <div className="data-grid"><section className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Luna / in-app assistant" title="Ask Luna about the workbench" description="Luna explains the dashboard, event contracts, research, paper trading and risk controls. It cannot submit or approve orders." action={<StatusChip value={state.settings.llmModel || "5.6 Luna Max"} tone="good" />} /><div aria-live="polite" aria-label="Luna conversation" className="max-h-[min(60vh,34rem)] min-h-40 space-y-3 overflow-y-auto rounded-xl border border-[#294343] bg-[#0b1719] p-3 sm:p-5">{messages.length ? messages.map((item, index) => <div key={`${item.created_at}-${index}`} className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}><div className={`max-w-[94%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${item.role === "user" ? "rounded-br-md bg-[#1e4438] text-[#dcefe5]" : "rounded-bl-md border border-[#294343] bg-[#122425] text-[#c9dbd5]"}`}><div className="mb-1 text-[0.65rem] uppercase tracking-[0.14em] text-[#7fa29a]">{item.role === "user" ? "You" : "Luna"}{item.model ? ` · ${item.model}` : ""}</div>{item.message}</div></div>) : <div className="flex min-h-28 items-center justify-center text-center text-sm leading-6 text-[#819b95]">Ask for help interpreting a quote, comparing paper-trading outcomes, understanding risk limits, or choosing the next research step.</div>}{loading ? <div className="text-sm text-[#9fdcc0]">Luna is thinking…</div> : null}</div><div className="mt-4 flex flex-col gap-3 sm:flex-row"><textarea aria-label="Ask Luna" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void ask(); }} placeholder="How should I interpret this market and what should I check next?" rows={3} className="min-h-24 min-w-0 flex-1 rounded-md border border-[#2d4446] bg-[#0d1b1d] px-3 py-2 text-sm text-[#d9e9e4] outline-none placeholder:text-[#67817c] focus-visible:ring-2 focus-visible:ring-[#8fd6b2]" /><div className="flex gap-2 sm:flex-col"><Button onClick={() => void ask()} disabled={loading || !input.trim()} className="min-h-11 flex-1"><Send className="size-4" />Ask Luna</Button><Button variant="outline" onClick={() => void clear()} disabled={!messages.length || loading} className="min-h-11 border-[#2d4446]"><Trash2 className="size-4" /><span className="sm:hidden">Clear</span></Button></div></div><div className="mt-3 flex flex-wrap gap-2">{["Explain the safest paper-trading workflow", "What risk checks apply here?", "Why is this proposal blocked?", "What should I verify before live mode?"].map((prompt) => <button key={prompt} type="button" onClick={() => setInput(prompt)} className="rounded-full border border-[#2d4446] px-3 py-2 text-xs text-[#a8c0b9] hover:border-[#8fd6b2]">{prompt}</button>)}</div>{error ? <p role="alert" className="mt-3 rounded-lg border border-[#ef8e8e]/30 bg-[#4f2525]/20 p-3 text-sm text-[#f0aaaa]">{error}</p> : null}</section><section className="surface min-w-0 p-5 sm:p-6"><SectionHeading eyebrow="Guardrails" title="Helper boundaries" description="The helper is connected to the current dashboard context but does not receive secrets." /><div className="space-y-3 text-sm leading-6 text-[#a9bfba]"><div className="surface-muted p-3"><ShieldCheck className="mr-2 inline size-4 text-[#9fe3c2]" />Human approval remains mandatory for every proposal.</div><div className="surface-muted p-3"><Database className="mr-2 inline size-4 text-[#9edaff]" />Conversation history is saved in D1 for future reference.</div><div className="surface-muted p-3"><LockKeyhole className="mr-2 inline size-4 text-[#efbd72]" />Never paste API keys, broker passwords, tokens or private account data.</div></div></section></div>;
}

function SettingsPanel({ settings, setSettings, onSave, actionLoading }: { settings: AppSettings; setSettings: (settings: AppSettings) => void; onSave: () => void; actionLoading: string | null }) {
  const update = (patch: Partial<AppSettings>) => setSettings({ ...settings, ...patch });
  return (
    <div className="data-grid">
      <section className="surface min-w-0 p-5 sm:p-6">
        <SectionHeading
          eyebrow="Configuration"
          title="Settings"
          description="Secrets are server-managed and are never displayed here. This Site is the control plane; the optional Windows bridge on your home computer provides the guarded IBKR connection. Switching to Live only changes the desired mode; live orders remain blocked unless the server gate and bridge are both healthy."
          action={<Button onClick={onSave} disabled={actionLoading === "settings"}>{actionLoading === "settings" ? <RefreshCw className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}Save settings</Button>}
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <SettingGroup title="Execution policy" description="Paper mode is the safe default.">
            <SettingRow label="Trading mode" help="Live mode is fail-closed until all server and bridge gates pass.">
              <Select value={settings.mode} onValueChange={(value) => update({ mode: value as "paper" | "live" })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="paper">Paper trading</SelectItem><SelectItem value="live">Live execution (guarded)</SelectItem></SelectContent>
              </Select>
            </SettingRow>
            <SettingRow label="Paper execution target" help="IBKR Paper sends an approved limit order through your local TWS API. Website simulator fills internally.">
              <Select value={settings.paperExecutionTarget} onValueChange={(value) => update({ paperExecutionTarget: value as "ibkr" | "site" })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="ibkr">IBKR Paper via TWS</SelectItem><SelectItem value="site">Website simulator</SelectItem></SelectContent>
              </Select>
            </SettingRow>
            <SettingRow label="Manual approval required" help="Every proposal must receive an explicit user action."><Switch checked={settings.manualApprovalRequired} onCheckedChange={(checked) => update({ manualApprovalRequired: checked })} /></SettingRow>
            <SettingRow label="Allow market orders" help="Event contracts are limit-only in the current IBKR event-trading documentation."><Switch checked={settings.allowMarketOrders} onCheckedChange={(checked) => update({ allowMarketOrders: checked })} /></SettingRow>
            <div className="rounded-lg border border-[#efbd72]/25 bg-[#4d3820]/15 p-3 text-xs leading-5 text-[#e4c68e]"><AlertTriangle className="mr-2 inline size-3.5" />Server live gate: {settings.liveTradingEnabled ? "enabled" : "disabled"} · Bridge: {settings.bridgeConfigured ? "configured" : "not configured"}</div>
          </SettingGroup>

          <SettingGroup title="Risk limits" description="Used by Site-side checks and mirrored by the bridge.">
            <NumberSetting label="Starting capital" value={settings.startingCapitalUsd} prefix="$" onChange={(value) => update({ startingCapitalUsd: Number(value) })} />
            <NumberSetting label="Minimum edge" value={settings.minEdge} step="0.01" suffix="probability points" onChange={(value) => update({ minEdge: Number(value) })} />
            <NumberSetting label="Minimum confidence" value={settings.minConfidence} step="0.01" suffix="0–1" onChange={(value) => update({ minConfidence: Number(value) })} />
            <NumberSetting label="Max position / contract" value={settings.maxPositionPerContractUsd} prefix="$" onChange={(value) => update({ maxPositionPerContractUsd: Number(value) })} />
            <NumberSetting label="Max total exposure" value={settings.maxTotalExposureUsd} prefix="$" onChange={(value) => update({ maxTotalExposureUsd: Number(value) })} />
            <NumberSetting label="Max order size" value={settings.maxOrderSizeUsd} prefix="$" onChange={(value) => update({ maxOrderSizeUsd: Number(value) })} />
            <NumberSetting label="Max daily loss" value={settings.maxDailyLossUsd} prefix="$" onChange={(value) => update({ maxDailyLossUsd: Number(value) })} />
            <NumberSetting label="Max concurrent orders" value={settings.maxConcurrentOrders} onChange={(value) => update({ maxConcurrentOrders: Number(value) })} />
            <NumberSetting label="Max slippage" value={settings.maxSlippagePercent} step="0.001" suffix="0–1" onChange={(value) => update({ maxSlippagePercent: Number(value) })} />
            <NumberSetting label="Account floor" value={settings.minAccountFloorPercent} suffix="% of starting capital" onChange={(value) => update({ minAccountFloorPercent: Number(value) })} />
          </SettingGroup>

          <SettingGroup title="Research" description="Estimates are labelled; evidence is stored with each research run.">
            <SettingRow label="Analysis provider" help="Deterministic uses market priors. OpenAI requires a configured server secret.">
              <Select value={settings.llmProvider} onValueChange={(value) => update({ llmProvider: value as "deterministic" | "openai" })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="deterministic">Deterministic baseline</SelectItem><SelectItem value="openai">OpenAI structured analysis</SelectItem></SelectContent>
              </Select>
            </SettingRow>
            <SettingRow label="Model name"><Input value={settings.llmModel} onChange={(event) => update({ llmModel: event.target.value })} /></SettingRow>
            <NumberSetting label="Refresh interval" value={settings.researchRefreshMinutes} suffix="minutes" onChange={(value) => update({ researchRefreshMinutes: Number(value) })} />
            <SettingRow label="RSS / Atom allowlist" help="HTTPS URLs only, comma or newline separated. Feeds use conditional requests and are not scraped arbitrarily.">
              <textarea aria-label="RSS / Atom allowlist" value={settings.newsRssUrls} onChange={(event) => update({ newsRssUrls: event.target.value })} rows={3} className="w-full min-w-0 rounded-md border border-[#2d4446] bg-[#0d1b1d] px-3 py-2 text-sm text-[#c7d9d3] outline-none placeholder:text-[#67817c] focus-visible:ring-2 focus-visible:ring-[#8fd6b2] sm:w-72" placeholder="https://www.example.gov/feed.xml" />
            </SettingRow>
            <div className="rounded-lg border border-[#294343] bg-[#102223] p-3 text-xs leading-5 text-[#8da6a1]">Evidence must have a valid HTTPS URL, publication time and freshness window before it can support a structured estimate.</div>
          </SettingGroup>

          <SettingGroup title="Bridge connection" description="The Site never stores broker passwords or private keys.">
            <SettingRow label="Connection mode"><div className="flex min-h-9 items-center justify-between gap-3 rounded-md border border-[#2d4446] bg-[#0d1b1d] px-3 text-sm text-[#bed0ca]"><span>Outbound HTTPS bridge</span><StatusChip value={settings.bridgeConfigured ? "Configured" : "Unavailable"} tone={settings.bridgeConfigured ? "good" : "warn"} /></div></SettingRow>
            <SettingRow label="Order timeout"><NumberSetting label="" value={settings.orderTimeoutSeconds} suffix="seconds" onChange={(value) => update({ orderTimeoutSeconds: Number(value) })} /></SettingRow>
            <div className="rounded-lg border border-[#294343] bg-[#102223] p-3 text-xs leading-5 text-[#8da6a1]"><Terminal className="mr-2 inline size-3.5 text-[#9fdcc0]" />Run the Windows bridge on the same home computer as TWS or IB Gateway. Its IBKR credentials stay there; the Site receives only signed outbound HTTPS events.</div>
          </SettingGroup>
        </div>
      </section>
    </div>
  );
}

function SettingGroup({ title, description, children }: { title: string; description: string; children: React.ReactNode }) { return <div className="surface-muted min-w-0 p-4 sm:p-5"><h3 className="font-medium text-[#d3e4de]">{title}</h3><p className="mt-1 text-xs leading-5 text-[#7f9994]">{description}</p><div className="mt-5 space-y-3">{children}</div></div>; }
function SettingRow({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) { return <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#253b3d] pb-3 last:border-b-0 last:pb-0"><div className="min-w-0"><p className="text-sm text-[#c7d9d3]">{label}</p>{help ? <p className="mt-1 max-w-sm text-xs leading-5 text-[#77918c]">{help}</p> : null}</div><div className="w-full shrink-0 sm:w-auto">{children}</div></div>; }
function NumberSetting({ label, value, prefix, suffix, step = "1", onChange }: { label: string; value: number; prefix?: string; suffix?: string; step?: string; onChange: (value: string) => void }) { return <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#253b3d] pb-3 last:border-b-0 last:pb-0"><label className="text-sm text-[#c7d9d3]">{label || "Value"}</label><div className="flex items-center gap-2"><div className="flex items-center rounded-md border border-[#2d4446] bg-[#0d1b1d] px-2"><span className="mono text-xs text-[#7f9994]">{prefix}</span><Input aria-label={label || "Value"} type="number" step={step} value={value} onChange={(event) => onChange(event.target.value)} className="h-8 w-24 border-0 bg-transparent px-2 text-right focus-visible:ring-0" /><span className="text-xs text-[#7f9994]">{suffix}</span></div></div></div>; }
