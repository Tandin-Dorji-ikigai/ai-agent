import { CallEndInputSchema } from "@/lib/agent/schemas";
import { finishCall } from "@/lib/calls/calls";
import { demoNow } from "@/lib/clock";
import { handleError, ok, parseBody } from "@/lib/http";
import { wrongSide } from "@/lib/viewer";

// POST /api/calls/end { call_id, role, force? }
// Call it after uploading your last part. When both people have finished (or
// the mentor ends it for both with force: true), the parts are merged into a
// transcript where every line's speaker is certain, the session completes,
// and the agent extracts draft actions for the mentor to confirm.
// Returns { finalized, waiting_for, transcript_turns, session_id, processing, outcome }.
export async function POST(req: Request) {
  const body = await parseBody(req, CallEndInputSchema);
  if ("error" in body) return body.error;
  const denied = await wrongSide(body.data.role);
  if (denied) return denied;
  try {
    const { call_id, role, force } = body.data;
    const result = await finishCall(call_id, role, force, await demoNow());
    return result.processing ? ok(result, { status: 202 }) : ok(result);
  } catch (err) {
    return handleError(err);
  }
}
