import { z } from "zod";
import { callTool } from "@/lib/agent/tools";
import { demoNow } from "@/lib/clock";
import { DEMO_IDS } from "@/lib/demo/ids";
import { fail, handleError, ok, parseBody } from "@/lib/http";
import { db, must } from "@/lib/supabase/server";

// POST /api/session/recap { session_id }: write the recap (what was discussed
// and achieved) for a session that has none yet, e.g. one completed before
// recaps existed. New sessions get theirs when the agent reads the session.
// Idempotent: an existing recap is returned as it is.
const Body = z.object({ session_id: z.uuid() });

export async function POST(req: Request) {
  const body = await parseBody(req, Body);
  if ("error" in body) return body.error;
  try {
    const session = must(
      await db()
        .from("sessions")
        .select("id, transcript, mentor_notes, agent_summary, recap, recap_source, bookings!inner(entrepreneur_id)")
        .eq("id", body.data.session_id)
        .eq("bookings.entrepreneur_id", DEMO_IDS.pema)
        .maybeSingle(),
      "load session",
    ) as { id: string; transcript: string | null; mentor_notes: string | null; agent_summary: string | null; recap: unknown; recap_source: string | null } | null;
    if (!session) return fail(404, "NOT_FOUND", "Session not found.");
    if (session.recap) return ok({ recap: session.recap, source: session.recap_source, reused: true });
    const notes = session.transcript?.trim() || session.mentor_notes?.trim();
    if (!notes) return fail(409, "NOTHING_TO_READ", "This session has no notes or transcript to recap.");
    const out = await callTool("write_session_recap", { session_id: session.id, notes, summary: session.agent_summary }, { now: await demoNow() });
    return ok({ ...out, reused: false });
  } catch (err) {
    return handleError(err);
  }
}
