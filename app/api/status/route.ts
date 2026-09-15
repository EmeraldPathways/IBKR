import { getStatus, jsonError, requireViewer } from "@/lib/server";

export async function GET() {
  try {
    await requireViewer();
    return Response.json(await getStatus());
  } catch (error) {
    return jsonError(error);
  }
}
