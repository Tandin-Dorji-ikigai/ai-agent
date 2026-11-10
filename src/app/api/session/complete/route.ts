import { emitAndRun } from "@/lib/agent/runner";
import { SINGLE_PASS_MAX_CHARS, SessionCompleteInputSchema } from "@/lib/agent/schemas";
import { demoNow } from "@/lib/clock";
import { DEMO_IDS } from "@/lib/demo/ids";
import { fail, handleError, ok, parseBody } from "@/lib/http";
import { db, must } from "@/lib/supabase/server";

// POST /api/session/complete (demo steps 9-10). The handover contract:
//   { booking_id, notes?, transcript?, source: "typed" | "voice_note" | "call_recording" }
// Notes and/or a call transcript go to the agent, which extracts SMART draft
// actions for the mentor to confirm. See ONBOARDING.md section 9.
export async function POST(req: Request) {
  const body = await parseBody(req, SessionCompleteInputSchema);
  if ("error" in body) return body.error;
  const { booking_id, notes, transcript, source } = body.data;
  // What the agent reads: notes first, then the transcript.
  const forAgent =
    notes && !transcript
      ? notes
      : [notes ? `Mentor notes:\n${notes}` : "", transcript ? `Call transcript:\n${transcript}` : ""].filter(Boolean).join("\n\n");
  if (forAgent.length > SINGLE_PASS_MAX_CHARS + 4100) {
    return fail(
      422,
      "TRANSCRIPT_TOO_LONG",
      `The agent can read up to ${SINGLE_PASS_MAX_CHARS.toLocaleString("en-IN")} characters of transcript at once (about 20 to 25 minutes of speech). Send a shorter part, or notes.`,
    );
  }
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
          {
            booking_id,
            mentor_notes: notes ?? null,
            transcript: transcript ?? null,
            notes_source: source,
            completed_at: now,
            created_at: now,
          },
          { onConflict: "booking_id", ignoreDuplicates: true },
        )
        .select("id"),
      "create session",
    );
    const session = must(
      await db().from("sessions").select("id").eq("booking_id", booking_id).single(),
      "load session",
    ) as { id: string };
    must(
      await db().from("bookings").update({ status: "completed", updated_at: now }).eq("id", booking_id).select("id"),
      "complete booking",
    );

    const outcome = await emitAndRun({
      event_type: "session.completed",
      entity_type: "session",
      entity_id: session.id,
      entrepreneur_id: DEMO_IDS.pema,
      payload: { notes: forAgent, source },
      dedupe_key: `session.completed:${session.id}`,
    });
    return ok({ session_id: session.id, outcome });
  } catch (err) {
    return handleError(err);
  }
}
