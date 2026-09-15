import { getProposalRows, jsonError, requireViewer } from "@/lib/server";

export async function GET() {
  try {
    await requireViewer();
    return Response.json({ proposals: await getProposalRows() });
  } catch (error) {
    return jsonError(error);
  }
}
