import { emitAndRun } from "@/lib/agent/runner";
import { FastForwardInputSchema } from "@/lib/agent/schemas";
import { DEMO_IDS } from "@/lib/demo/ids";
import { handleError, ok, parseBody } from "@/lib/http";
import { db, must } from "@/lib/supabase/server";

// POST /api/demo/fast-forward { days }: moves the demo clock (never the real
// clock), marks actions overdue and runs the agent follow-up (demo step 12).
export async function POST(req: Request) {
  const body = await parseBody(req, FastForwardInputSchema);
  if ("error" in body) return body.error;
  try {
    const result = must(
      await db().rpc("fast_forward_demo", { p_days: body.data.days, p_entrepreneur_id: DEMO_IDS.pema }),
      "fast forward",
    ) as { demo_now: string; clock_offset_days: number; overdue_action_ids: string[] };

    const outcomes = [];
    for (const actionId of result.overdue_action_ids) {
      outcomes.push(
        await emitAndRun({
          event_type: "action.overdue",
          entity_type: "action_item",
          entity_id: actionId,
          entrepreneur_id: DEMO_IDS.pema,
          dedupe_key: `action.overdue:${actionId}`,
        }),
      );
    }
    return ok({
      demo_now: result.demo_now,
      clock_offset_days: result.clock_offset_days,
      overdue_action_ids: result.overdue_action_ids,
      event_ids: outcomes.map((o) => o.event_id),
      outcomes,
    });
  } catch (err) {
    return handleError(err);
  }
}
