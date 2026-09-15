import { ApiError, jsonError, recordHeartbeat, verifyBridgeRequest } from "@/lib/server";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const { bridgeId } = await verifyBridgeRequest(request, rawBody);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      throw new ApiError("Bridge heartbeat payload must be valid JSON.", 400, "invalid_json");
    }
    return Response.json(await recordHeartbeat({ ...payload, bridge_id: bridgeId }, bridgeId));
  } catch (error) {
    return jsonError(error);
  }
}
