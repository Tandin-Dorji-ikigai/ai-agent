import { DEMO_IDS } from "@/lib/demo/ids";
import { handleError, ok } from "@/lib/http";
import { ensureMentorRequest } from "@/lib/requests";

// POST /api/requests/start: makes sure the agent is asking a mentor for the
// mentee, with no button. The entrepreneur view calls it by itself when there
// are matches but nobody is being asked. Does nothing if a mentor is already
// deciding, a session is booked, YDF is handling it, or the agent is busy.
// Returns { started, reason: asked | retried | already_asked | in_progress | booked | with_ydf }.
export async function POST() {
  try {
    return ok(await ensureMentorRequest(DEMO_IDS.pema));
  } catch (err) {
    return handleError(err);
  }
}
