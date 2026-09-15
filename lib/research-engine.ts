type NewsRow = {
  id: string;
  title: string;
  url: string;
  source: string;
  published_at: string;
  summary: string;
};

export type NewsEvidence = {
  title: string;
  url: string;
  publishedAt: string;
  source: string;
};

export type FeedRefreshResult = {
  items: NewsRow[];
  fetched: number;
  notModified: number;
  skipped: number;
  errors: string[];
};

const MAX_FEEDS = 12;
const MAX_FEED_BYTES = 500_000;
const MAX_ITEMS_PER_FEED = 40;
const MIN_FETCH_INTERVAL_MS = 30_000;
const MAX_EVIDENCE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type D1Like = D1Database;
type Row = Record<string, unknown>;

export function parseFeedUrls(value: string | null): string[] {
  if (!value) return [];
  const unique = new Set<string>();
  for (const raw of value.split(/[\n,]/g).map((item) => item.trim()).filter(Boolean)) {
    if (unique.size >= MAX_FEEDS) break;
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:" || isPrivateHostname(url.hostname)) continue;
      url.hash = "";
      unique.add(url.toString());
    } catch {
      // Invalid feed URLs are ignored and surfaced by the settings UI as an empty feed list.
    }
  }
  return [...unique];
}

export async function refreshConfiguredFeeds(
  db: D1Like,
  configuredUrls: string | null,
  refreshMinutes = 15,
  now = new Date(),
): Promise<FeedRefreshResult> {
  const urls = parseFeedUrls(configuredUrls);
  const result: FeedRefreshResult = { items: [], fetched: 0, notModified: 0, skipped: 0, errors: [] };
  const minInterval = Math.max(MIN_FETCH_INTERVAL_MS, Math.max(1, refreshMinutes) * 60_000);

  for (const feedUrl of urls) {
    const host = new URL(feedUrl).hostname;
    const stateKey = `news_feed_state:${await shortHash(feedUrl)}`;
    const state = await readState(db, stateKey);
    const lastFetchedAt = state.lastFetchedAt ? Date.parse(state.lastFetchedAt) : NaN;
    if (Number.isFinite(lastFetchedAt) && now.getTime() - lastFetchedAt < minInterval) {
      result.skipped += 1;
      continue;
    }

    const headers = new Headers({ Accept: "application/atom+xml, application/rss+xml, application/xml, text/xml" });
    if (state.etag) headers.set("If-None-Match", state.etag);
    if (state.lastModified) headers.set("If-Modified-Since", state.lastModified);

    try {
      const response = await fetchWithTimeout(feedUrl, headers);
      const nextState = {
        ...state,
        lastFetchedAt: now.toISOString(),
        etag: response.headers.get("ETag") ?? state.etag ?? null,
        lastModified: response.headers.get("Last-Modified") ?? state.lastModified ?? null,
        lastStatus: response.status,
        lastError: null,
      };

      if (response.status === 304) {
        result.notModified += 1;
        result.items.push(...await recentItems(db, host, now));
        await writeState(db, stateKey, nextState);
        continue;
      }
      if (response.status === 429) {
        result.errors.push(`${host}: HTTP 429; feed refresh deferred.`);
        await writeState(db, stateKey, { ...nextState, lastError: "HTTP 429" });
        continue;
      }
      if (!response.ok) {
        result.errors.push(`${host}: HTTP ${response.status}.`);
        await writeState(db, stateKey, { ...nextState, lastError: `HTTP ${response.status}` });
        continue;
      }

      const xml = await response.text();
      if (xml.length > MAX_FEED_BYTES) {
        result.errors.push(`${host}: feed exceeded the size limit.`);
        await writeState(db, stateKey, { ...nextState, lastError: "size_limit" });
        continue;
      }
      const parsed = await parseFeed(xml, feedUrl, now);
      const statements: D1PreparedStatement[] = parsed.items.map((item) => db.prepare(
        `INSERT OR IGNORE INTO news_items
         (id, title, url, source, published_at, content_hash, summary, raw_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      ).bind(item.id, item.title, item.url, item.source, item.publishedAt, item.contentHash, item.summary, now.toISOString()));
      if (statements.length) await db.batch(statements);
      result.fetched += 1;
      result.items.push(...parsed.items.map((item) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        source: item.source,
        published_at: item.publishedAt,
        summary: item.summary,
      })));
      await writeState(db, stateKey, nextState);
    } catch (error) {
      const message = error instanceof Error ? error.message : "request failed";
      result.errors.push(`${host}: ${message}`);
      await writeState(db, stateKey, { ...state, lastFetchedAt: now.toISOString(), lastError: "request_failed" });
    }
  }

  return result;
}

export async function collectResearchEvidence(
  db: D1Like,
  configuredUrls: string | null,
  question: string,
  refreshMinutes = 15,
  now = new Date(),
): Promise<NewsEvidence[]> {
  const refresh = await refreshConfiguredFeeds(db, configuredUrls, refreshMinutes, now);
  const terms = question.toLowerCase().split(/[^a-z0-9]+/g).filter((term) => term.length >= 4 && !STOP_WORDS.has(term));
  const candidates = refresh.items
    .filter((item) => isFreshEvidence(item.published_at, now))
    .map((item) => {
      const haystack = `${item.title} ${item.summary}`.toLowerCase();
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { item, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || Date.parse(b.item.published_at) - Date.parse(a.item.published_at))
    .slice(0, 6);
  return candidates.map(({ item }) => ({
    title: item.title,
    url: item.url,
    publishedAt: item.published_at,
    source: item.source,
  }));
}

export function isFreshEvidence(value: string, now = new Date()): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now.getTime() + 5 * 60_000 && now.getTime() - timestamp <= MAX_EVIDENCE_AGE_MS;
}

async function fetchWithTimeout(url: string, headers: Headers): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function parseFeed(xml: string, feedUrl: string, now: Date): Promise<{ items: Array<{ id: string; title: string; url: string; source: string; publishedAt: string; contentHash: string; summary: string }> }> {
  const source = new URL(feedUrl).hostname;
  const items: Array<{ id: string; title: string; url: string; source: string; publishedAt: string; contentHash: string; summary: string }> = [];
  const blockPattern = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of xml.matchAll(blockPattern)) {
    if (items.length >= MAX_ITEMS_PER_FEED) break;
    const block = match[2] ?? "";
    const title = cleanXml(firstElement(block, "title"));
    const url = cleanUrl(feedLink(block));
    const publishedAt = cleanXml(firstElement(block, "pubDate") || firstElement(block, "published") || firstElement(block, "updated") || firstElement(block, "date"));
    const publishedTimestamp = Date.parse(publishedAt);
    if (!title || !url || !Number.isFinite(publishedTimestamp) || publishedTimestamp > now.getTime() + 5 * 60_000) continue;
    const summary = cleanXml(firstElement(block, "description") || firstElement(block, "summary") || firstElement(block, "content:encoded")).slice(0, 600);
    const contentHash = await shortHash(`${title}\n${url}\n${new Date(publishedTimestamp).toISOString()}\n${summary}`);
    items.push({
      id: `news_${contentHash}`,
      title,
      url,
      source,
      publishedAt: new Date(publishedTimestamp).toISOString(),
      contentHash,
      summary,
    });
  }
  return { items };
}

function firstElement(xml: string, name: string): string {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match?.[1] ?? "";
}

function feedLink(xml: string): string {
  const href = xml.match(/<link\b[^>]*\bhref=["']([^"']+)["']/i)?.[1];
  return href ?? (firstElement(xml, "link") || firstElement(xml, "guid"));
}

function cleanXml(value: string): string {
  return decodeEntities(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function cleanUrl(value: string): string {
  const cleaned = cleanXml(value);
  try {
    const url = new URL(cleaned);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host === "::1") return true;
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}

async function shortHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function readState(db: D1Like, key: string): Promise<Row & { etag?: string | null; lastModified?: string | null; lastFetchedAt?: string | null }> {
  const row = await db.prepare("SELECT value_json FROM app_settings WHERE key = ?").bind(key).first<{ value_json?: string }>();
  if (!row?.value_json) return {};
  try {
    return JSON.parse(row.value_json) as Row & { etag?: string | null; lastModified?: string | null; lastFetchedAt?: string | null };
  } catch {
    return {};
  }
}

async function writeState(db: D1Like, key: string, value: Row): Promise<void> {
  await db.prepare(
    `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  ).bind(key, JSON.stringify(value), new Date().toISOString()).run();
}

async function recentItems(db: D1Like, source: string, now: Date): Promise<NewsRow[]> {
  const since = new Date(now.getTime() - MAX_EVIDENCE_AGE_MS).toISOString();
  const result = await db.prepare(
    `SELECT id, title, url, source, published_at, summary
     FROM news_items WHERE source = ? AND published_at >= ? ORDER BY published_at DESC LIMIT 40`,
  ).bind(source, since).all<NewsRow>();
  return result.results ?? [];
}

const STOP_WORDS = new Set(["will", "what", "when", "above", "below", "from", "with", "this", "that", "have", "been", "target", "rate", "event", "contract"]);
