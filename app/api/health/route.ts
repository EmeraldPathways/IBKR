import { readAppHealth } from "@/lib/server";

export async function GET() {
  return Response.json(await readAppHealth());
}
