import { SessionCompleteInputSchema } from "@/lib/agent/schemas";
import { handleError, ok, parseBody } from "@/lib/http";
import { completeSession } from "@/lib/sessions";

// POST /api/session/complete (demo steps 9-10). The handover contract:
//   { booking_id, notes?, transcript?, source: "typed" | "voice_note" | "call_recording" }
// Notes and/or a call transcript go to the agent, which extracts SMART draft
// actions for the mentor to confirm. See ONBOARDING.md section 9.
// Long transcripts return 202 { processing: true } and are read in the background.
// (A call that ends with recordings completes the session the same way.)
export async function POST(req: Request) {
  const body = await parseBody(req, SessionCompleteInputSchema);
  if ("error" in body) return body.error;
  try {
    const result = await completeSession(body.data);
    return result.processing ? ok(result, { status: 202 }) : ok(result);
  } catch (err) {
    return handleError(err);
  }
}
