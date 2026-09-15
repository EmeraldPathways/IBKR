import { getMarkets, jsonError, requireViewer } from "@/lib/server";

export async function GET() {
  try {
    await requireViewer();
    const markets = await getMarkets();
    return Response.json({ quotes: markets.map((market) => ({
      marketId: market.id,
      question: market.question,
      yes: market.yes,
      no: market.no,
      updatedAt: market.yes?.quoteObservedAt ?? market.no?.quoteObservedAt ?? null,
    })) });
  } catch (error) {
    return jsonError(error);
  }
}
