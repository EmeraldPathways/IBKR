import { jsonError, requireViewer, resetPaperPortfolio } from "@/lib/server";

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    const payload = (await request.json()) as { startingBalance?: number };
    return Response.json(await resetPaperPortfolio(Number(payload.startingBalance), viewer));
  } catch (error) {
    return jsonError(error);
  }
}
