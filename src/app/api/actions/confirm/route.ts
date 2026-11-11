import { ConfirmActionsInputSchema } from "@/lib/agent/schemas";
import { callTool } from "@/lib/agent/tools";
import { demoNow } from "@/lib/clock";
import { DEMO_IDS } from "@/lib/demo/ids";
import { handleError, ok, parseBody } from "@/lib/http";
import { db, must } from "@/lib/supabase/server";
import type { ActionItemRecord } from "@/lib/types";

// POST /api/actions/confirm: a human confirms the agent's draft actions (step 11).
// The mentor may untick every draft (none were really agreed); that still
// confirms the notes, which opens the follow-up request to the mentee.
// Idempotent: confirming twice changes nothing and sends no second message.
export async function POST(req: Request) {
  const body = await parseBody(req, ConfirmActionsInputSchema);
  if ("error" in body) return body.error;
  try {
    const drafts = must(
      await db().from("action_items").select("id").eq("session_id", body.data.session_id).eq("status", "draft"),
      "load drafts",
    ) as Array<{ id: string }>;

    const session = must(
      await db().from("sessions").select("summary_confirmed").eq("id", body.data.session_id).maybeSingle(),
      "load session",
    ) as { summary_confirmed: boolean } | null;

    const res = await db().rpc("confirm_action_items", {
      p_session_id: body.data.session_id,
      p_action_ids: body.data.action_ids,
    });
    const actions = must(res, "confirm actions") as ActionItemRecord[];

    if (drafts.length > 0 && actions.length === 0 && session && !session.summary_confirmed) {
      // The mentor unticked every draft: tell the mentee nothing was agreed and the follow-up is open.
      await callTool(
        "send_inbox_message",
        {
          entrepreneur_id: DEMO_IDS.pema,
          kind: "info",
          body: "Your mentor confirmed the notes from your session. No next steps were agreed this time. When you are ready, you can ask them for a follow-up session from My bookings.",
          source: "system",
        },
        { now: await demoNow() },
      );
    } else if (drafts.length > 0 && actions.length > 0) {
      const now = await demoNow();
      const list = actions
        .map((a) => `- ${a.title} (due ${new Date(a.due_at!).toLocaleDateString("en-GB", { day: "numeric", month: "short" })})`)
        .join("\n");
      await callTool(
        "send_inbox_message",
        {
          entrepreneur_id: DEMO_IDS.pema,
          kind: "info",
          body: `Your actions from the session are confirmed:\n${list}\nI will check in on each one before it is due.`,
          source: "system",
        },
        { now },
      );
    }
    return ok({ actions });
  } catch (err) {
    return handleError(err);
  }
}
