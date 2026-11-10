import { ActionStatusInputSchema } from "@/lib/agent/schemas";
import { callTool } from "@/lib/agent/tools";
import { demoNow } from "@/lib/clock";
import { DEMO_IDS } from "@/lib/demo/ids";
import { handleError, ok, parseBody } from "@/lib/http";

// POST /api/actions/status: Pema marks one of her actions as done.
export async function POST(req: Request) {
  const body = await parseBody(req, ActionStatusInputSchema);
  if ("error" in body) return body.error;
  try {
    const action = await callTool(
      "update_action_status",
      { entrepreneur_id: DEMO_IDS.pema, action_id: body.data.action_id, status: body.data.status },
      { now: await demoNow() },
    );
    return ok({ action });
  } catch (err) {
    return handleError(err);
  }
}
