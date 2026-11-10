import { connection } from "next/server";
import { handleError } from "@/lib/http";
import { buildDemoState } from "@/lib/state";
import { currentViewer } from "@/lib/viewer";

// GET /api/state: the whole demo state for all three views, plus who this
// device is signed in as (`viewer`), so screens can hide what that role cannot do.
export async function GET() {
  await connection(); // always request-time; never prerendered or cached
  try {
    const [state, viewer] = await Promise.all([buildDemoState(), currentViewer()]);
    return Response.json({ ...state, viewer }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return handleError(err);
  }
}
