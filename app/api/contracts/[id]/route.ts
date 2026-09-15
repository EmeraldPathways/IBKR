import { getContract, jsonError, requireViewer } from "@/lib/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireViewer();
    const contract = await getContract((await params).id);
    if (!contract) return Response.json({ error: "Contract not found" }, { status: 404 });
    return Response.json({ contract });
  } catch (error) {
    return jsonError(error);
  }
}
