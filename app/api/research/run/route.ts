import { jsonError, requireViewer, runResearch } from "@/lib/server";

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    const payload = (await request.json()) as { contractId?: string };
    if (!payload.contractId) return Response.json({ error: "contractId is required" }, { status: 400 });
    return Response.json(await runResearch(payload.contractId, viewer), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
