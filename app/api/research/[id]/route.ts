import { getResearch, jsonError, requireViewer } from "@/lib/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireViewer();
    return Response.json(await getResearch((await params).id));
  } catch (error) {
    return jsonError(error);
  }
}
