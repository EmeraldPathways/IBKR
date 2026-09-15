import { jsonError, requireViewer, simulateResolution } from "@/lib/server";

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    const payload = (await request.json()) as { contractId?: string; outcome?: string };
    if (!payload.contractId || !["YES", "NO"].includes(String(payload.outcome).toUpperCase())) return Response.json({ error: "contractId and outcome YES or NO are required" }, { status: 400 });
    return Response.json(await simulateResolution(payload.contractId, String(payload.outcome).toUpperCase() as "YES" | "NO", viewer));
  } catch (error) {
    return jsonError(error);
  }
}
