import { getStockSnapshot } from "@/lib/stock-research";
import { jsonError, requireViewer } from "@/lib/server";

export async function POST(request: Request) {
  try {
    await requireViewer();
    const body = await request.json().catch(() => null) as { tickers?: unknown } | null;
    const tickers = Array.isArray(body?.tickers) ? body.tickers.filter((item): item is string => typeof item === "string").slice(0, 2) : [];
    if (!tickers.length) return Response.json({ competitors: [], message: "Provide up to two competitor tickers from the same business." });
    const competitors = [];
    for (const ticker of tickers) {
      try { competitors.push(await getStockSnapshot(ticker)); } catch { /* one invalid competitor should not hide the valid one */ }
    }
    return Response.json({ competitors }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
