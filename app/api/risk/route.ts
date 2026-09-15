import { getRiskSummary, jsonError, requireViewer } from "@/lib/server";

export async function GET() {
  try {
    await requireViewer();
    return Response.json(await getRiskSummary());
  } catch (error) {
    return jsonError(error);
  }
}
