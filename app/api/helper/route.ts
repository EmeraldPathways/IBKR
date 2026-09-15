import { getD1, nowIso, requireViewer, jsonError, type Viewer } from "@/lib/server";

type RuntimeEnv = { OPENAI_API_KEY?: string; OPENAI_MODEL?: string; OPENAI_BASE_URL?: string; OPENAI_HELPER_MODEL?: string; MANAGER_MODEL?: string };
type HelperMessage = { role: "user" | "assistant"; message: string; model: string; created_at: string };

const DEFAULT_MODEL = "gpt-5-mini";
const MAX_HISTORY = 12;
const localHistory = new Map<string, HelperMessage[]>();

const REDACTIONS = [
  /sk-[A-Za-z0-9_-]{16,}/gi,
  /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /(?:api[_-]?key|token|password|secret|private[_-]?key|cookie)\s*[:=]\s*[^\s,;]+/gi,
  /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gi,
];

export function sanitizeHelperText(value: string, maxLength = 4000): string {
  let safe = value.replace(/\u0000/g, "");
  for (const pattern of REDACTIONS) safe = safe.replace(pattern, "[REDACTED]");
  return safe.trim().slice(0, maxLength);
}

async function runtime(): Promise<RuntimeEnv> {
  try {
    const { env } = await import("cloudflare:workers");
    return env as unknown as RuntimeEnv;
  } catch {
    if (typeof process !== "undefined") return process.env as RuntimeEnv;
    return {};
  }
}

function historyFor(ownerId: string): HelperMessage[] {
  return localHistory.get(ownerId) ?? [];
}

async function viewerAndDb(): Promise<{ viewer: Viewer; db: D1Database | null }> {
  return { viewer: await requireViewer(), db: await getD1() };
}

async function loadHistory(ownerId: string, db: D1Database | null): Promise<HelperMessage[]> {
  if (!db) return historyFor(ownerId);
  const result = await db.prepare("SELECT role, message, model, created_at FROM helper_messages WHERE owner_id = ? ORDER BY id DESC LIMIT ?").bind(ownerId, MAX_HISTORY).all<HelperMessage>();
  return (result.results ?? []).reverse();
}

const INSTRUCTIONS = `You are Luna Max, the expert in-app helper for IBKR Event Contract Workbench.

Help the user understand this private dashboard, event-contract research, forecasting, paper trading, proposals, risk controls, D1 history, Alpaca research-only context, and the optional Windows outbound bridge. Explain concepts clearly for a non-expert user.

Rules:
- This is an advisory helper. Never submit, approve, cancel, or modify an order and never claim that you did.
- Live execution always requires explicit human approval, Site and bridge gates, fresh quotes, permissions, sufficient funds, passed risk checks, and an inactive kill switch.
- Paper trading is simulated. Clearly distinguish facts shown by the app, estimates, assumptions, recommendations, and unknowns.
- Do not invent IBKR permissions, contract availability, prices, fees, settlement rules, account data, or regulatory/tax conclusions. Tell the user when they must verify the official IBKR source or their own account.
- Never ask for or retain broker passwords, API keys, private keys, access tokens, 2FA codes, or secrets. Ask the user to remove them from pasted text.
- Recommend limit orders and conservative risk checks. Do not promise profits or present a forecast as certainty.
- The browser cannot connect to TWS and cannot directly submit IBKR orders. The Windows bridge is optional, localhost-oriented, outbound HTTPS, and fails closed.

Answer with: a direct explanation, the relevant app location, one practical next step, and a short safety/uncertainty note when relevant.`;

function extractOutput(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string" && record.output_text.trim()) return record.output_text.trim();
  if (!Array.isArray(record.output)) return null;
  for (const item of record.output) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    if (typeof value.text === "string" && value.text.trim()) return value.text.trim();
    if (Array.isArray(value.content)) for (const part of value.content) {
      if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") return String((part as Record<string, unknown>).text).trim();
    }
  }
  return null;
}

async function persist(db: D1Database | null, ownerId: string, messages: HelperMessage[]) {
  if (db) {
    const rows = messages.slice(-2);
    await db.batch(rows.map((item) => db.prepare("INSERT INTO helper_messages (owner_id, role, message, model, view, program, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(ownerId, item.role, item.message, item.model, null, null, item.created_at)));
  } else {
    localHistory.set(ownerId, [...historyFor(ownerId), ...messages].slice(-MAX_HISTORY));
  }
}

export async function GET() {
  try {
    const { viewer, db } = await viewerAndDb();
    return Response.json({ available: Boolean(db), history: await loadHistory(viewer.id, db) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}

export async function DELETE() {
  try {
    const { viewer, db } = await viewerAndDb();
    if (db) await db.prepare("DELETE FROM helper_messages WHERE owner_id = ?").bind(viewer.id).run();
    localHistory.delete(viewer.id);
    return Response.json({ cleared: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const { viewer, db } = await viewerAndDb();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const message = typeof body?.message === "string" ? sanitizeHelperText(body.message, 6000) : "";
    if (!message) return Response.json({ error: "Ask Luna a focused question." }, { status: 400 });
    const context = typeof body?.context === "string" ? sanitizeHelperText(body.context, 2500) : "";
    const view = typeof body?.view === "string" ? sanitizeHelperText(body.view, 80) : "Unknown";
    const env = await runtime();
    const model = env.OPENAI_HELPER_MODEL?.trim() || env.OPENAI_MODEL?.trim() || env.MANAGER_MODEL?.trim() || DEFAULT_MODEL;
    const baseUrl = (env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, "");
    const apiKey = env.OPENAI_API_KEY?.trim();
    if (!apiKey) return Response.json({ error: "Luna is not configured. Add the Site-managed OPENAI_API_KEY secret." }, { status: 503 });
    const history = await loadHistory(viewer.id, db);
    const transcript = history.map((item) => `${item.role === "user" ? "User" : "Luna"}: ${sanitizeHelperText(item.message, 1600)}`).join("\n");
    const input = `${transcript ? `Recent conversation:\n${transcript}\n\n` : ""}Current app area: ${view}\n${context ? `App context: ${context}\n` : ""}User question: ${message}`;
    const response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, store: false, instructions: INSTRUCTIONS, input, max_output_tokens: 900, reasoning: { effort: "low" } }),
    });
    if (response.status === 401 || response.status === 403) return Response.json({ error: "Luna authentication failed. Update the Site-managed API secret." }, { status: 502 });
    if (response.status === 429) return Response.json({ error: "Luna is temporarily rate-limited. Try again shortly." }, { status: 429 });
    if (!response.ok) return Response.json({ error: "Luna could not answer right now. Please try again shortly." }, { status: 502 });
    const answer = extractOutput(await response.json());
    if (!answer) return Response.json({ error: "Luna returned no usable answer." }, { status: 502 });
    const now = nowIso();
    const messages: HelperMessage[] = [{ role: "user", message, model, created_at: now }, { role: "assistant", message: sanitizeHelperText(answer, 8000), model, created_at: now }];
    await persist(db, viewer.id, messages);
    return Response.json({ answer: messages[1].message, model, history: [...history, ...messages].slice(-MAX_HISTORY) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
