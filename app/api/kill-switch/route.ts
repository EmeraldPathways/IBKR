import { jsonError, requireViewer, setKillSwitch } from "@/lib/server";

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    const payload = (await request.json()) as { active?: boolean; reason?: string };
    return Response.json(await setKillSwitch(Boolean(payload.active), payload.reason?.trim() ?? "", viewer));
  } catch (error) {
    return jsonError(error);
  }
}
