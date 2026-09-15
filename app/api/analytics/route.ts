import { getForecastAnalytics, getProfessionalAnalytics, jsonError, requireViewer } from "@/lib/server";

export async function GET() {
  try {
    await requireViewer();
    const [forecast, professional] = await Promise.all([getForecastAnalytics(), getProfessionalAnalytics()]);
    return Response.json({ ...forecast, professional });
  } catch (error) {
    return jsonError(error);
  }
}
