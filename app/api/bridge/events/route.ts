import { ApiError, jsonError, recordBridgeEvents, verifyBridgeRequest } from "@/lib/server";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const { bridgeId } = await verifyBridgeRequest(request, rawBody);
    let payload: { events?: Array<Record<string, unknown>> };
    try {
      payload = JSON.parse(rawBody) as { events?: Array<Record<string, unknown>> };
    } catch {
      throw new ApiError("Bridge event payload must be valid JSON.", 400, "invalid_json");
    }
    return Response.json(await recordBridgeEvents(Array.isArray(payload.events) ? payload.events : [], bridgeId));
  } catch (error) {
    return jsonError(error);
  }
}
