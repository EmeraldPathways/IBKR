import { getStockSnapshot } from "@/lib/stock-research";
import { bridgeJob, enqueueJob, getSettings, jsonError, latestBridgeStockSnapshot, latestHeartbeat, requireViewer } from "@/lib/server";

export async function GET(_request: Request, context: { params: Promise<{ ticker: string }> }) {
  try {
    await requireViewer();
    const { ticker } = await context.params;
    const normalizedTicker = ticker.trim().toUpperCase();
    const settings = await getSettings();
    const heartbeat = await latestHeartbeat();
    const bridgeConnected = Boolean(settings.bridgeConfigured && heartbeat && Date.now() - Date.parse(String(heartbeat.observed_at)) <= 60_000);
    if (bridgeConnected) {
      const requestedAt = Date.now();
      const jobId = await enqueueJob("bridge_command", { command: "deep_research_stock", ticker: normalizedTicker }, `deep_research_stock:${normalizedTicker}:${Math.floor(requestedAt / 30_000)}`);
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline) {
        const [snapshot, job] = await Promise.all([latestBridgeStockSnapshot(normalizedTicker), bridgeJob(jobId)]);
        if (snapshot && Date.parse(String(snapshot.updatedAt)) >= requestedAt - 2_000) {
          return Response.json(snapshot.snapshot, { headers: { "Cache-Control": "no-store", "X-Research-Source": "windows-yfinance" } });
        }
        if (job?.status === "failed") break;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
    const snapshot = await getStockSnapshot(normalizedTicker);
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store", "X-Research-Source": "site-http-fallback" } });
  } catch (error) {
    return jsonError(error);
  }
}
