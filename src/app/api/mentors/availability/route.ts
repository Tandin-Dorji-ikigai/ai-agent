import { MentorAvailabilityInputSchema } from "@/lib/agent/schemas";
import { demoNow } from "@/lib/clock";
import { fail, handleError, ok, parseBody } from "@/lib/http";
import { upcomingSlots } from "@/lib/matching/slots";
import { db, must } from "@/lib/supabase/server";

// POST /api/mentors/availability { mentor_id, weekly_slots: [{ day: "tue", time: "17:30" }] }
// The mentor's usual weekly times, in Bhutan time. A new request offers the
// next of these (open requests keep the times they already offered).
// Returns { weekly_slots, next_times } (next_times: what a request sent now would offer).
export async function POST(req: Request) {
  const body = await parseBody(req, MentorAvailabilityInputSchema);
  if ("error" in body) return body.error;
  try {
    const { mentor_id, weekly_slots } = body.data;
    const sorted = [...weekly_slots].sort((a, b) => "sun mon tue wed thu fri sat".indexOf(a.day) - "sun mon tue wed thu fri sat".indexOf(b.day) || a.time.localeCompare(b.time));
    const updated = must(
      await db().from("mentor_profiles").update({ weekly_slots: sorted, updated_at: new Date().toISOString() }).eq("user_id", mentor_id).select("user_id"),
      "save availability",
    ) as Array<{ user_id: string }>;
    if (updated.length === 0) return fail(404, "NOT_FOUND", "Mentor not found.");
    return ok({ mentor_id, weekly_slots: sorted, next_times: upcomingSlots(sorted, await demoNow()) });
  } catch (err) {
    return handleError(err);
  }
}
