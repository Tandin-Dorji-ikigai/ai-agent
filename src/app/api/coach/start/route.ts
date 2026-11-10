import { startCoach } from "@/lib/coach-actions";
import { handleError, ok } from "@/lib/http";

// POST /api/coach/start: begin the beginner coach (for someone with no idea yet).
// The agent writes step 1 for this person. Calling it again does nothing new.
export async function POST() {
  try {
    return ok(await startCoach());
  } catch (err) {
    return handleError(err);
  }
}
