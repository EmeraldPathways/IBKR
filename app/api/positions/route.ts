import { getPositionRows, jsonError, requireViewer } from "@/lib/server";

export async function GET() {
  try {
    await requireViewer();
    return Response.json({ positions: await getPositionRows() });
  } catch (error) {
    return jsonError(error);
  }
}
