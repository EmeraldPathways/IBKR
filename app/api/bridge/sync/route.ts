import { ApiError, enqueueJob, getSettings, jsonError, requireViewer } from "@/lib/server";

export async function POST() {
  try {
    const viewer = await requireViewer();
    const settings = await getSettings();
    if (!settings.bridgeConfigured) throw new ApiError("Configure the bridge token before requesting a catalog sync.", 409, "bridge_not_configured");
    const jobId = await enqueueJob(
      "bridge_command",
      { command: "sync_catalog", requested_by: viewer.id },
      `sync_catalog:${Math.floor(Date.now() / 60_000)}`,
    );
    return Response.json({ jobId, status: "pending" }, { status: 202 });
  } catch (error) {
    return jsonError(error);
  }
}
