import { AcceptRequestInputSchema } from "@/lib/agent/schemas";
import { handleError, ok, parseBody } from "@/lib/http";
import { acceptRequest } from "@/lib/requests";

// POST /api/requests/accept { request_id, scheduled_at }: the MENTOR says yes
// and picks one of the offered times. Books the session (YDF credit is used
// only now) and the agent prepares both briefs. Repeating returns the same booking.
export async function POST(req: Request) {
  const body = await parseBody(req, AcceptRequestInputSchema);
  if ("error" in body) return body.error;
  try {
    return ok(await acceptRequest(body.data.request_id, body.data.scheduled_at));
  } catch (err) {
    return handleError(err);
  }
}
