import { emitAndRun } from "@/lib/agent/runner";
import { InboxReplyInputSchema } from "@/lib/agent/schemas";
import { demoNow } from "@/lib/clock";
import { DEMO_IDS } from "@/lib/demo/ids";
import { fail, handleError, ok, parseBody } from "@/lib/http";
import { db, must } from "@/lib/supabase/server";

// POST /api/inbox/reply: Pema answers the agent's follow-up (demo step 13).
// The reply is claimed atomically, so a double click cannot trigger two decisions.
export async function POST(req: Request) {
  const body = await parseBody(req, InboxReplyInputSchema);
  if ("error" in body) return body.error;
  try {
    const now = (await demoNow()).toISOString();
    const claimed = must(
      await db()
        .from("messages")
        .update({ awaiting_reply: false })
        .eq("id", body.data.message_id)
        .eq("entrepreneur_id", DEMO_IDS.pema)
        .eq("awaiting_reply", true)
        .select("id, related_action_id"),
      "claim follow-up",
    ) as Array<{ id: string; related_action_id: string | null }>;
    if (claimed.length === 0) return fail(409, "ALREADY_ANSWERED", "This message was already answered.");

    must(
      await db()
        .from("messages")
        .insert({
          entrepreneur_id: DEMO_IDS.pema,
          sender: "entrepreneur",
          kind: "reply",
          body: body.data.body,
          related_action_id: claimed[0].related_action_id,
          source: "human",
          created_at: now,
        })
        .select("id"),
      "save reply",
    );

    if (!claimed[0].related_action_id) return ok({ outcome: null });

    const outcome = await emitAndRun({
      event_type: "entrepreneur.blocked",
      entity_type: "action_item",
      entity_id: claimed[0].related_action_id,
      entrepreneur_id: DEMO_IDS.pema,
      payload: { action_id: claimed[0].related_action_id, blocker: body.data.body, reply_to: body.data.message_id },
      dedupe_key: `entrepreneur.blocked:${body.data.message_id}`,
    });
    return ok({ outcome });
  } catch (err) {
    return handleError(err);
  }
}
