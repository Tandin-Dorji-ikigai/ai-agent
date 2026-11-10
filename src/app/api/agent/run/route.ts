import { processEvent } from "@/lib/agent/runner";
import { AgentRunInputSchema } from "@/lib/agent/schemas";
import { handleError, ok, parseBody } from "@/lib/http";

// POST /api/agent/run: retry a pending or failed agent event.
export async function POST(req: Request) {
  const body = await parseBody(req, AgentRunInputSchema);
  if ("error" in body) return body.error;
  try {
    return ok({ outcome: await processEvent(body.data.event_id) });
  } catch (err) {
    return handleError(err);
  }
}
