import { connection } from "next/server";
import { handleError } from "@/lib/http";
import { buildDemoState } from "@/lib/state";

// GET /api/state: the whole demo state for all three views.
export async function GET() {
  await connection(); // always request-time; never prerendered or cached
  try {
    return Response.json(await buildDemoState(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return handleError(err);
  }
}
