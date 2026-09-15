import { getSettings, jsonError, requireViewer, saveSettings } from "@/lib/server";

export async function GET() {
  try {
    await requireViewer();
    return Response.json(await getSettings());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireViewer();
    return Response.json(await saveSettings((await request.json()) as Record<string, unknown>));
  } catch (error) {
    return jsonError(error);
  }
}
