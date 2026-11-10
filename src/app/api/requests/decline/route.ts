import { DeclineRequestInputSchema } from "@/lib/agent/schemas";
import { demoNow } from "@/lib/clock";
import { handleError, ok, parseBody } from "@/lib/http";
import { declineRequest } from "@/lib/requests";

// POST /api/requests/decline { request_id, reason, note? }: the MENTOR says no.
// The agent then asks the next best mentor, or hands over to YDF after three.
export async function POST(req: Request) {
  const body = await parseBody(req, DeclineRequestInputSchema);
  if ("error" in body) return body.error;
  try {
    const { request_id, reason, note } = body.data;
    return ok(await declineRequest(request_id, reason, note, await demoNow()));
  } catch (err) {
    return handleError(err);
  }
}
