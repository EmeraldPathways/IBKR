import { getAlpacaSummary, jsonError, requireViewer } from "@/lib/server";

export async function GET() {
  try {
    await requireViewer();
    return Response.json(await getAlpacaSummary());
  } catch (error) {
    return jsonError(error);
  }
}
