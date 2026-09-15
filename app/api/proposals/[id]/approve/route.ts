import { approveProposal, jsonError, requireViewer } from "@/lib/server";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requireViewer();
    return Response.json(await approveProposal((await params).id, viewer));
  } catch (error) {
    return jsonError(error);
  }
}
