import { getDataHealth, jsonError, requireViewer } from "@/lib/server";

export async function GET() {
  try {
    await requireViewer();
    return Response.json(await getDataHealth());
  } catch (error) {
    return jsonError(error);
  }
}
