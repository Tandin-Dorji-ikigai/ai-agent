import { emitAndRun } from "@/lib/agent/runner";
import { SessionCompleteInputSchema } from "@/lib/agent/schemas";
import { demoNow } from "@/lib/clock";
import { DEMO_IDS } from "@/lib/demo/ids";
import { fail, handleError, ok, parseBody } from "@/lib/http";
import { db, must } from "@/lib/supabase/server";

// POST /api/session/complete: the mentor submits quick notes (demo steps 9-10).
export async function POST(req: Request) {
  const body = await parseBody(req, SessionCompleteInputSchema);
  if ("error" in body) return body.error;
  const { booking_id, notes } = body.data;
  try {
    const now = (await demoNow()).toISOString();
    const booking = must(
      await db().from("bookings").select("id, entrepreneur_id, status").eq("id", booking_id).maybeSingle(),
      "load booking",
    ) as { id: string; entrepreneur_id: string; status: string } | null;
    if (!booking || booking.entrepreneur_id !== DEMO_IDS.pema) return fail(404, "NOT_FOUND", "Booking not found.");
    if (booking.status === "cancelled") return fail(409, "BOOKING_CANCELLED", "This booking was cancelled.");

    // One session per booking; a repeat submit reuses the first one.
    must(
      await db()
        .from("sessions")
        .upsert(
          { booking_id, mentor_notes: notes, completed_at: now, created_at: now },
          { onConflict: "booking_id", ignoreDuplicates: true },
        )
        .select("id"),
      "create session",
    );
    const session = must(
      await db().from("sessions").select("id, mentor_notes").eq("booking_id", booking_id).single(),
      "load session",
    ) as { id: string; mentor_notes: string };
    must(
      await db().from("bookings").update({ status: "completed", updated_at: now }).eq("id", booking_id).select("id"),
      "complete booking",
    );

    const outcome = await emitAndRun({
      event_type: "session.completed",
      entity_type: "session",
      entity_id: session.id,
      entrepreneur_id: DEMO_IDS.pema,
      payload: { notes: session.mentor_notes },
      dedupe_key: `session.completed:${session.id}`,
    });
    return ok({ session_id: session.id, outcome });
  } catch (err) {
    return handleError(err);
  }
}
