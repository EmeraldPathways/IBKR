import { getAgentStatus, jsonError, requireViewer, startAgentWorkflow } from "@/lib/server";

export async function GET() {
  try {
    await requireViewer();
    return Response.json(await getAgentStatus());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    const payload = (await request.json()) as { contractId?: string };
    if (!payload.contractId) return Response.json({ error: "contractId is required" }, { status: 400 });
    return Response.json(await startAgentWorkflow(payload.contractId, viewer), { status: 202 });
  } catch (error) {
    return jsonError(error);
  }
}
