import { getPortfolioSummary, jsonError, requireViewer } from "@/lib/server";

export async function GET() {
  try {
    await requireViewer();
    return Response.json(await getPortfolioSummary());
  } catch (error) {
    return jsonError(error);
  }
}
