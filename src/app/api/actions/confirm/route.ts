import { ConfirmActionsInputSchema } from "@/lib/agent/schemas";
import { callTool } from "@/lib/agent/tools";
import { demoNow } from "@/lib/clock";
import { DEMO_IDS } from "@/lib/demo/ids";
import { handleError, ok, parseBody } from "@/lib/http";
import { db, must } from "@/lib/supabase/server";
import type { ActionItemRecord } from "@/lib/types";

// POST /api/actions/confirm: a human confirms the agent's draft actions (step 11).
// Idempotent: confirming twice changes nothing and sends no second message.
export async function POST(req: Request) {
  const body = await parseBody(req, ConfirmActionsInputSchema);
  if ("error" in body) return body.error;
  try {
    const drafts = must(
      await db().from("action_items").select("id").eq("session_id", body.data.session_id).eq("status", "draft"),
      "load drafts",
    ) as Array<{ id: string }>;

    const res = await db().rpc("confirm_action_items", {
      p_session_id: body.data.session_id,
      p_action_ids: body.data.action_ids,
    });
    const actions = must(res, "confirm actions") as ActionItemRecord[];

    if (drafts.length > 0 && actions.length > 0) {
      const now = await demoNow();
      const list = actions
        .map((a) => `- ${a.title} (due ${new Date(a.due_at!).toLocaleDateString("en-GB", { day: "numeric", month: "short" })})`)
        .join("\n");
      await callTool(
        "send_inbox_message",
        {
          entrepreneur_id: DEMO_IDS.pema,
          kind: "info",
          body: `Your actions from the session are confirmed:\n${list}\nI will check in if anything slips.`,
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
