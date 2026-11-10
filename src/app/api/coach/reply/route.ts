import { CoachReplyInputSchema } from "@/lib/agent/schemas";
import { replyToCoach } from "@/lib/coach-actions";
import { handleError, ok, parseBody } from "@/lib/http";

// POST /api/coach/reply { step, reply, source? }: what the mentee found on the
// open step. The agent reads it and asks for more, sets the next step, or
// (after step 4) hands over to a human mentor. Returns { outcome }.
export async function POST(req: Request) {
  const body = await parseBody(req, CoachReplyInputSchema);
  if ("error" in body) return body.error;
  try {
    return ok({ outcome: await replyToCoach(body.data.step, body.data.reply, body.data.source) });
  } catch (err) {
    return handleError(err);
  }
}
