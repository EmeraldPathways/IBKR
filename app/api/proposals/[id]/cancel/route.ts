import { jsonError, requireViewer, updateProposalStatus } from "@/lib/server";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const viewer = await requireViewer();
    return Response.json(await updateProposalStatus((await params).id, "cancelled", viewer));
  } catch (error) {
    return jsonError(error);
  }
}
