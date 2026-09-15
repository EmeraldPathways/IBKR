import { getOrderRows, jsonError, requireViewer } from "@/lib/server";

export async function GET() {
  try {
    await requireViewer();
    return Response.json({ orders: await getOrderRows() });
  } catch (error) {
    return jsonError(error);
  }
}
