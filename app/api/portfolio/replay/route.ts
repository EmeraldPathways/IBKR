import { jsonError, replayProposal, requireViewer } from "@/lib/server";

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    const payload = (await request.json()) as { proposalId?: string };
    if (!payload.proposalId) return Response.json({ error: "proposalId is required" }, { status: 400 });
    return Response.json(await replayProposal(payload.proposalId, viewer), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
