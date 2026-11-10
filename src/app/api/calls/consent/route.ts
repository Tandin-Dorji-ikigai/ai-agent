import { CallConsentInputSchema } from "@/lib/agent/schemas";
import { setConsent } from "@/lib/calls/calls";
import { demoNow } from "@/lib/clock";
import { handleError, ok, parseBody } from "@/lib/http";

// POST /api/calls/consent { call_id, role, consent: true | false }
// Recording starts only when BOTH people agree. consent: false withdraws it
// and deletes that person's recorded parts. Returns { recording: { allowed, ... } }.
export async function POST(req: Request) {
  const body = await parseBody(req, CallConsentInputSchema);
  if ("error" in body) return body.error;
  try {
    const { call_id, role, consent } = body.data;
    return ok(await setConsent(call_id, role, consent, await demoNow()));
  } catch (err) {
    return handleError(err);
  }
}
