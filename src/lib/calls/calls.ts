import "server-only";
import { randomBytes } from "node:crypto";
import { aiMode } from "../agent/ai";
import { RateLimitError, transcribeApiKey } from "../agent/llm";
import type { RunOutcome } from "../agent/runner";
import { ToolError } from "../agent/tools";
import { transcribeSegments, type TimedSegment } from "../audio/transcribe";
import { demoTrackSegments } from "../demo/fixtures";
import { DEMO_IDS } from "../demo/ids";
import { completeSession } from "../sessions";
import { db, must } from "../supabase/server";
import { mergeTracks, type CallRole } from "./merge";
import { callProvider, createRoom, deleteRoom, joinToken, livekitUrl, type CallProviderName } from "./provider";

// Calls for a booked session (rules in supabase/migrations/..._calls.sql):
// confirmed bookings only, the two participants only, one room per booking,
// recording only when both agree, audio never stored, and when the call ends
// the agent gets a transcript where every line's speaker is certain.

export interface CallRow {
  id: string;
  booking_id: string;
  provider: CallProviderName | "daily";
  room_name: string;
  room_url: string | null;
  status: "open" | "ended";
  mentor_joined_at: string | null;
  entrepreneur_joined_at: string | null;
  mentor_consent_at: string | null;
  entrepreneur_consent_at: string | null;
  mentor_done_at: string | null;
  entrepreneur_done_at: string | null;
  transcript_built_at: string | null;
  ended_at: string | null;
}

/**
 * Length of each uploaded part: small enough for the hosted 4.5 MB request
 * limit (about 0.7 MB at speech quality), and a dropped connection loses at
 * most one part.
 */
export const PART_SECONDS = 180;
/** How long a room and its links stay valid after the first join. */
const ROOM_HOURS = 6;
const TRANSCRIBE_TIMEOUT_MS = 60_000;

export function recordingState(call: CallRow) {
  const mentor = !!call.mentor_consent_at;
  const entrepreneur = !!call.entrepreneur_consent_at;
  return { mentor_agreed: mentor, entrepreneur_agreed: entrepreneur, allowed: mentor && entrepreneur && call.status === "open" };
}

async function loadCall(callId: string): Promise<CallRow> {
  const call = must(await db().from("calls").select("*").eq("id", callId).maybeSingle(), "load call") as CallRow | null;
  if (!call) throw new ToolError("NOT_FOUND", "Call not found.");
  return call;
}

function requireOpen(call: CallRow) {
  if (call.status !== "open") throw new ToolError("CALL_ENDED", "This call has ended.");
}

/** Optional: calls open only near the session time (CALL_WINDOW_MINUTES; off by default for the demo). */
function checkWindow(scheduledAt: string, now: Date) {
  const minutes = Number(process.env.CALL_WINDOW_MINUTES ?? 0);
  if (!minutes) return;
  const at = new Date(scheduledAt).getTime();
  if (now.getTime() < at - minutes * 60_000) {
    throw new ToolError("CALL_NOT_OPEN_YET", `The call opens ${minutes} minutes before the session.`);
  }
}

/**
 * Joining: only the booking's mentor or entrepreneur, only while the booking
 * is confirmed. Creates the room on first join; returns a personal link.
 */
export async function joinCall(bookingId: string, role: CallRole, now: Date) {
  const booking = must(
    await db()
      .from("bookings")
      .select("id, entrepreneur_id, mentor_id, status, scheduled_at")
      .eq("id", bookingId)
      .maybeSingle(),
    "load booking",
  ) as { id: string; entrepreneur_id: string; mentor_id: string; status: string; scheduled_at: string } | null;
  if (!booking || booking.entrepreneur_id !== DEMO_IDS.pema) throw new ToolError("NOT_FOUND", "Booking not found.");
  if (booking.status === "completed") throw new ToolError("CALL_ENDED", "This session has already ended.");
  if (booking.status !== "confirmed") throw new ToolError("CALL_NOT_AVAILABLE", "Calls are only for confirmed sessions.");
  checkWindow(booking.scheduled_at, now);

  // One room per booking (a second join, or both joining at once, gets the same room).
  must(
    await db()
      .from("calls")
      .upsert(
        { booking_id: bookingId, provider: callProvider(), room_name: `ydf-${randomBytes(12).toString("hex")}`, created_at: now.toISOString() },
        { onConflict: "booking_id", ignoreDuplicates: true },
      )
      .select("id"),
    "create call",
  );
  let call = must(await db().from("calls").select("*").eq("booking_id", bookingId).single(), "load call") as CallRow;
  requireOpen(call);

  if (call.provider === "livekit" && !call.room_url) {
    const url = await createRoom(call.room_name);
    call = must(await db().from("calls").update({ room_url: url }).eq("id", call.id).select("*").single(), "save room") as CallRow;
  }
  const joinedField = role === "mentor" ? "mentor_joined_at" : "entrepreneur_joined_at";
  const consentField = role === "mentor" ? "mentor_consent_at" : "entrepreneur_consent_at";
  // Tell the other person only when this is the first one in (rejoining, or
  // joining after them, sends nothing).
  const firstIn = !call[joinedField] && !call[role === "mentor" ? "entrepreneur_joined_at" : "mentor_joined_at"];
  if (!call[joinedField]) {
    // Joining is agreeing to recording: the call screen says the call is
    // recorded, before and during it, and either person can stop it
    // (setConsent false, which deletes their recorded parts). Only the FIRST
    // join agrees, so rejoining never switches a stopped recording back on.
    // Nothing is recorded until both people have joined.
    call = must(
      await db().from("calls").update({ [joinedField]: now.toISOString(), [consentField]: now.toISOString() }).eq("id", call.id).select("*").single(),
      "record join",
    ) as CallRow;
  }

  const person = must(
    await db()
      .from("profiles")
      .select("full_name")
      .eq("id", role === "mentor" ? booking.mentor_id : booking.entrepreneur_id)
      .single(),
    "load participant",
  ) as { full_name: string };
  // A personal pass for this person and this room only (identity = role, so a
  // second tab for the same person replaces the first instead of adding a third).
  const token = call.provider === "livekit" ? await joinToken(call.room_name, role, person.full_name, ROOM_HOURS * 3600) : null;

  return {
    call_id: call.id,
    provider: call.provider,
    room_name: call.room_name,
    livekit: token ? { url: call.room_url ?? livekitUrl(), token } : null,
    display_name: person.full_name,
    recording: recordingState(call),
    // The client records its own microphone and stamps each part in SERVER
    // time: offset = server_time_ms - Date.now() at the moment this arrives.
    server_time_ms: Date.now(),
    part_seconds: PART_SECONDS,
    /** The other person has not joined yet: the route sends them a push notification. */
    notify_other: firstIn,
  };
}

/**
 * Stop (consent false) or turn back on (true) recording for one person.
 * Joining already agrees (see joinCall). Recording needs both people;
 * stopping deletes that person's recorded parts.
 */
export async function setConsent(callId: string, role: CallRole, consent: boolean, now: Date) {
  let call = await loadCall(callId);
  requireOpen(call);
  const field = role === "mentor" ? "mentor_consent_at" : "entrepreneur_consent_at";
  if (consent && !call[field]) {
    call = must(await db().from("calls").update({ [field]: now.toISOString() }).eq("id", callId).select("*").single(), "save consent") as CallRow;
  } else if (!consent) {
    // Switch it off first, then delete: a part saved in between is caught by
    // this delete, and one saved after it sees the switch and removes itself.
    call = must(await db().from("calls").update({ [field]: null }).eq("id", callId).select("*").single(), "withdraw consent") as CallRow;
    must(await db().from("call_track_parts").delete().eq("call_id", callId).eq("role", role).select("id"), "delete recordings");
  }
  return { call_id: callId, recording: recordingState(call) };
}

/**
 * One part of one person's microphone recording. It is transcribed now and
 * the audio is discarded; only the timed text is kept. Uploading the same
 * part again returns the first result.
 */
export async function uploadPart(input: { callId: string; role: CallRole; part: number; startedAtMs: number; file: Blob; filename: string }) {
  const call = await loadCall(input.callId);
  requireOpen(call);
  if (!recordingState(call).allowed) throw new ToolError("RECORDING_NOT_ALLOWED", "Recording needs both people to agree first.");

  const existing = must(
    await db().from("call_track_parts").select("id, segments, source").eq("call_id", call.id).eq("role", input.role).eq("part", input.part).maybeSingle(),
    "load part",
  ) as { id: string; segments: TimedSegment[]; source: string } | null;
  if (existing) return { part_id: existing.id, segments: existing.segments.length, source: existing.source, reused: true };

  let segments: TimedSegment[];
  let source: "live_ai" | "fallback";
  if (aiMode() === "live" && transcribeApiKey()) {
    try {
      segments = await transcribeSegments(input.file, input.filename, AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS), "en");
    } catch (err) {
      console.warn("[calls] track transcription failed:", err instanceof Error ? err.message.slice(0, 200) : "error");
      if (err instanceof RateLimitError) throw new ToolError("RATE_LIMITED", "Transcription is busy. Upload this part again in a minute.");
      throw new ToolError("TRANSCRIPTION_FAILED", "This part could not be transcribed. Upload it again.");
    }
    source = "live_ai";
  } else {
    // Saved-response mode: the demo call, as this person's microphone would have heard it.
    segments = input.part === 0 ? demoTrackSegments(input.role) : [];
    source = "fallback";
  }

  const res = await db()
    .from("call_track_parts")
    .insert({ call_id: call.id, role: input.role, part: input.part, started_at: new Date(input.startedAtMs).toISOString(), segments, source })
    .select("id")
    .single();
  if (res.error?.code === "23505") return uploadPart(input); // the same part arrived twice at once: return the first
  const row = must(res, "save part") as { id: string };
  // Transcribing takes a while: if this person stopped the recording meanwhile, keep nothing.
  if (!recordingState(await loadCall(input.callId)).allowed) {
    must(await db().from("call_track_parts").delete().eq("id", row.id).select("id"), "discard part");
    throw new ToolError("RECORDING_NOT_ALLOWED", "The recording was stopped, so this part was not kept.");
  }
  return { part_id: row.id, segments: segments.length, source, reused: false };
}

export interface FinishResult {
  call_id: string;
  finalized: boolean;
  /** Who has not finished yet (when not finalized). */
  waiting_for: CallRole | null;
  transcript_turns: number;
  session_id: string | null;
  processing: boolean;
  outcome: RunOutcome | null;
}

/**
 * One person has finished (their last part is uploaded). When both have, or
 * when the mentor ends it for both, the parts are merged into a transcript
 * with certain speakers and the session is completed for the agent.
 */
export async function finishCall(callId: string, role: CallRole, force: boolean, now: Date): Promise<FinishResult> {
  let call = await loadCall(callId);
  const field = role === "mentor" ? "mentor_done_at" : "entrepreneur_done_at";
  if (!call[field] && call.status === "open") {
    call = must(await db().from("calls").update({ [field]: now.toISOString() }).eq("id", callId).select("*").single(), "record finish") as CallRow;
  }
  const bothDone = !!call.mentor_done_at && !!call.entrepreneur_done_at;
  const base = { call_id: callId, transcript_turns: 0, session_id: null, processing: false, outcome: null };
  if (!bothDone && !(force && role === "mentor") && call.status === "open") {
    return { ...base, finalized: false, waiting_for: call.mentor_done_at ? "entrepreneur" : "mentor" };
  }

  // Exactly one request builds the transcript.
  const claimed = must(
    await db()
      .from("calls")
      .update({ transcript_built_at: now.toISOString(), status: "ended", ended_at: call.ended_at ?? now.toISOString() })
      .eq("id", callId)
      .is("transcript_built_at", null)
      .select("*"),
    "claim call",
  ) as CallRow[];
  if (claimed.length === 0) return { ...base, finalized: true, waiting_for: null };
  await deleteRoom(call.room_name);

  const parts = must(
    await db().from("call_track_parts").select("role, started_at, segments").eq("call_id", callId).order("part"),
    "load parts",
  ) as Array<{ role: CallRole; started_at: string; segments: TimedSegment[] }>;
  const merged = mergeTracks(parts.map((p) => ({ role: p.role, startedAtMs: Date.parse(p.started_at), segments: p.segments })));
  if (merged.dropped.echo || merged.dropped.silence) {
    console.info(`[calls] transcript merged: ${merged.turns.length} turns; dropped ${merged.dropped.echo} echo and ${merged.dropped.silence} silence pieces`);
  }

  const booking = must(await db().from("bookings").select("status").eq("id", call.booking_id).single(), "load booking") as { status: string };
  // No recording (someone did not agree), or the mentor already completed the session with notes.
  if (!merged.text || booking.status === "completed") return { ...base, finalized: true, waiting_for: null, transcript_turns: merged.turns.length };

  const done = await completeSession({ booking_id: call.booking_id, transcript: merged.text, source: "call_recording" });
  return { ...base, finalized: true, waiting_for: null, transcript_turns: merged.turns.length, ...done };
}
