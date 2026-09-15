import { getStockSnapshot, researchWithModel } from "@/lib/stock-research";
import { jsonError, requireViewer } from "@/lib/server";

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    const body = await request.json().catch(() => null) as { ticker?: string } | null;
    if (!body?.ticker) return Response.json({ error: "ticker is required" }, { status: 400 });
    const snapshot = await getStockSnapshot(body.ticker);
    const research = await researchWithModel(snapshot, viewer.id);
    return Response.json({ snapshot, research }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
