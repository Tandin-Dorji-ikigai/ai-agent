import { z } from "zod";
import { callTool } from "@/lib/agent/tools";
import { demoNow } from "@/lib/clock";
import { DEMO_IDS } from "@/lib/demo/ids";
import { fail, handleError, ok, parseBody } from "@/lib/http";
import { db, must } from "@/lib/supabase/server";

// POST /api/session/recap { session_id }: write the session summary (what was
// discussed, the mentor's advice, what was achieved, a next step and a
// follow-up date) for a session that has none yet, or only an older recap
// without advice and a follow-up date. New sessions get theirs when the agent
// reads the session. Idempotent: a full summary is returned as it is.
const Body = z.object({ session_id: z.uuid() });

export async function POST(req: Request) {
  const body = await parseBody(req, Body);
  if ("error" in body) return body.error;
  try {
    const session = must(
      await db()
        .from("sessions")
        .select("id, transcript, mentor_notes, agent_summary, recap, recap_source, completed_at, bookings!inner(entrepreneur_id)")
        .eq("id", body.data.session_id)
        .eq("bookings.entrepreneur_id", DEMO_IDS.pema)
        .maybeSingle(),
      "load session",
    ) as {
      id: string;
      transcript: string | null;
      mentor_notes: string | null;
      agent_summary: string | null;
      recap: { follow_up_on?: string | null } | null;
      recap_source: string | null;
      completed_at: string | null;
    } | null;
    if (!session) return fail(404, "NOT_FOUND", "Session not found.");
    if (session.recap && session.recap.follow_up_on !== undefined) return ok({ recap: session.recap, source: session.recap_source, reused: true });
    const notes = session.transcript?.trim() || session.mentor_notes?.trim();
    if (!notes) return fail(409, "NOTHING_TO_READ", "This session has no notes or transcript to recap.");
    const out = await callTool(
      "write_session_recap",
      { session_id: session.id, notes, summary: session.agent_summary, held_at: session.completed_at },
      { now: await demoNow() },
    );
    return ok({ ...out, reused: false });
  } catch (err) {
    return handleError(err);
  }
}
