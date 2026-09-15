import { exportPaperHistory, jsonError, requireViewer } from "@/lib/server";

export async function GET() {
  try {
    await requireViewer();
    return new Response(await exportPaperHistory(), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=paper-trading-history.csv",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
