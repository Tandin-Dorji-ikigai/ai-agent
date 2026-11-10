import { emitAndRun } from "@/lib/agent/runner";
import { AskMentorInputSchema } from "@/lib/agent/schemas";
import { loadEntrepreneur, loadMentor } from "@/lib/data";
import { DEMO_IDS } from "@/lib/demo/ids";
import { fail, handleError, ok, parseBody } from "@/lib/http";
import { isBookable } from "@/lib/matching/requests";
import { db, must } from "@/lib/supabase/server";

// POST /api/requests/ask { mentor_id }: the MENTEE asks for a specific mentor
// (a follow-up with their mentor, or one the agent suggested). The agent sends
// the request; the mentor decides.
export async function POST(req: Request) {
  const body = await parseBody(req, AskMentorInputSchema);
  if ("error" in body) return body.error;
  try {
    const id = DEMO_IDS.pema;
    const [entrepreneur, mentor] = await Promise.all([loadEntrepreneur(id), loadMentor(body.data.mentor_id)]);
    if (!entrepreneur?.assessment_completed_at) return fail(409, "ASSESSMENT_REQUIRED", "Complete the needs assessment first.");
    if (!mentor || !mentor.verified || !mentor.active) return fail(409, "MENTOR_NOT_BOOKABLE", "This mentor cannot be booked.");
    if (!isBookable(mentor)) return fail(409, "MENTOR_FULLY_BOOKED", "This mentor has no open sessions right now.");
    const upcoming = must(
      await db().from("bookings").select("id").eq("entrepreneur_id", id).eq("mentor_id", mentor.id).eq("status", "confirmed").limit(1),
      "check upcoming sessions",
    ) as Array<{ id: string }>;
    if (upcoming.length > 0) return fail(409, "BOOKING_ALREADY_ACTIVE", "You already have an upcoming session with this mentor.");

    const outcome = await emitAndRun({
      event_type: "mentor.selected",
      entity_type: "mentor",
      entity_id: mentor.id,
      entrepreneur_id: id,
      payload: { mentor_id: mentor.id },
    });
    if (outcome.status === "failed") return fail(500, "AGENT_FAILED", outcome.error ?? "The request could not be sent.");
    return ok({ outcome });
  } catch (err) {
    return handleError(err);
  }
}
