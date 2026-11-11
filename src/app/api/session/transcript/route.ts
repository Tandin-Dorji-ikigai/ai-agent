import { z } from "zod";
import { DEMO_IDS } from "@/lib/demo/ids";
import { fail, handleError, ok } from "@/lib/http";
import { db, must } from "@/lib/supabase/server";
import { transcriptTurns } from "@/lib/transcript-turns";

// GET /api/session/transcript?session_id=…: the whole call transcript of one
// session as chat turns, for the mentee and the mentor. Kept out of /api/state
// (polled every few seconds) because a long call is a lot of text.
const SessionId = z.uuid();

export async function GET(req: Request) {
  const id = SessionId.safeParse(new URL(req.url).searchParams.get("session_id"));
  if (!id.success) return fail(400, "INVALID_INPUT", "session_id must be a session id.");
  try {
    const row = must(
      await db()
        .from("sessions")
        .select("transcript, notes_source, bookings!inner(entrepreneur_id)")
        .eq("id", id.data)
        .eq("bookings.entrepreneur_id", DEMO_IDS.pema)
        .maybeSingle(),
      "load transcript",
    ) as { transcript: string | null; notes_source: string | null } | null;
    if (!row) return fail(404, "NOT_FOUND", "Session not found.");
    return ok({ turns: row.transcript ? transcriptTurns(row.transcript) : [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return handleError(err);
  }
}
