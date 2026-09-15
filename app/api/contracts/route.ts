import { getMarkets, jsonError, requireViewer } from "@/lib/server";

export async function GET() {
  try {
    await requireViewer();
    return Response.json({ markets: await getMarkets() });
  } catch (error) {
    return jsonError(error);
  }
}
