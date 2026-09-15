import { claimBridgeJobs, jsonError, verifyBridgeRequest } from "@/lib/server";

export async function GET(request: Request) {
  try {
    const { bridgeId } = await verifyBridgeRequest(request);
    const url = new URL(request.url);
    const limit = Math.min(25, Math.max(1, Number(url.searchParams.get("limit") ?? 10)));
    return Response.json({ commands: await claimBridgeJobs(bridgeId, limit), serverTime: Date.now() });
  } catch (error) {
    return jsonError(error);
  }
}
