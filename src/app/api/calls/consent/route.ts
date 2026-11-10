import { CallConsentInputSchema } from "@/lib/agent/schemas";
import { setConsent } from "@/lib/calls/calls";
import { demoNow } from "@/lib/clock";
import { handleError, ok, parseBody } from "@/lib/http";
import { wrongSide } from "@/lib/viewer";

// POST /api/calls/consent { call_id, role, consent: true | false }
// Joining the call already agrees to recording (see joinCall), so this is the
// Stop / Record again button: consent false stops it for both and deletes that
// person's recorded parts; true turns it back on. Recording needs both.
// Returns { recording: { allowed, ... } }.
export async function POST(req: Request) {
  const body = await parseBody(req, CallConsentInputSchema);
  if ("error" in body) return body.error;
  const denied = await wrongSide(body.data.role);
  if (denied) return denied;
  try {
    const { call_id, role, consent } = body.data;
    return ok(await setConsent(call_id, role, consent, await demoNow()));
  } catch (err) {
    return handleError(err);
  }
}
