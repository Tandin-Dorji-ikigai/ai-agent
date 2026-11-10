import "server-only";
import { after } from "next/server";
import { emitAndRun, type RunOutcome } from "./agent/runner";
import { SINGLE_PASS_MAX_CHARS, type NotesSource } from "./agent/schemas";
import { ToolError } from "./agent/tools";
import { deleteRoom } from "./calls/provider";
import { demoNow } from "./clock";
import { DEMO_IDS } from "./demo/ids";
import { db, must } from "./supabase/server";

// Completing a session: the handover to the agent. Used by
// POST /api/session/complete (typed notes, a voice note, an uploaded
// recording) and by a call ending (a transcript with certain speakers).

export interface CompleteSessionInput {
  booking_id: string;
  notes?: string;
  transcript?: string;
  source: NotesSource;
}

export interface CompleteSessionResult {
  session_id: string;
  /** true: a long transcript is being read in the background. */
  processing: boolean;
  outcome: RunOutcome | null;
}

export async function completeSession({ booking_id, notes, transcript, source }: CompleteSessionInput): Promise<CompleteSessionResult> {
  // What the agent reads: notes first, then the transcript.
  const forAgent =
    notes && !transcript
      ? notes
      : [notes ? `Mentor notes:\n${notes}` : "", transcript ? `Call transcript:\n${transcript}` : ""].filter(Boolean).join("\n\n");
  // Long call transcripts are read in the background (split into parts and
  // paced to the free tier); the mentor view shows progress until drafts appear.
  const isLong = forAgent.length > SINGLE_PASS_MAX_CHARS + 4100;

  const now = (await demoNow()).toISOString();
  const booking = must(
    await db().from("bookings").select("id, entrepreneur_id, status").eq("id", booking_id).maybeSingle(),
    "load booking",
  ) as { id: string; entrepreneur_id: string; status: string } | null;
  if (!booking || booking.entrepreneur_id !== DEMO_IDS.pema) throw new ToolError("NOT_FOUND", "Booking not found.");
  if (booking.status === "cancelled") throw new ToolError("BOOKING_CANCELLED", "This booking was cancelled.");

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
  const session = must(await db().from("sessions").select("id").eq("booking_id", booking_id).single(), "load session") as { id: string };
  must(await db().from("bookings").update({ status: "completed", updated_at: now }).eq("id", booking_id).select("id"), "complete booking");

  // The call room closes when the session completes.
  const open = must(
    await db().from("calls").update({ status: "ended", ended_at: now }).eq("booking_id", booking_id).eq("status", "open").select("room_name"),
    "close call",
  ) as Array<{ room_name: string }>;
  for (const c of open) await deleteRoom(c.room_name);

  const emit = () =>
    emitAndRun({
      event_type: "session.completed",
      entity_type: "session",
      entity_id: session.id,
      entrepreneur_id: DEMO_IDS.pema,
      payload: { notes: forAgent, source },
      dedupe_key: `session.completed:${session.id}`,
    });
  if (isLong) {
    after(async () => {
      const done = await emit();
      if (done.status === "failed") console.warn("[agent] long transcript extraction failed:", done.error);
    });
    return { session_id: session.id, processing: true, outcome: null };
  }
  return { session_id: session.id, processing: false, outcome: await emit() };
}
