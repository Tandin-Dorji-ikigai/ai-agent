import { skipCoach } from "@/lib/coach-actions";
import { demoNow } from "@/lib/clock";
import { handleError, ok } from "@/lib/http";

// POST /api/coach/skip: "Ask a human mentor now". Coaching stops and the usual
// mentor request starts (the coach can be resumed later with /api/coach/start).
export async function POST() {
  try {
    await skipCoach(await demoNow());
    return ok({});
  } catch (err) {
    return handleError(err);
  }
}
