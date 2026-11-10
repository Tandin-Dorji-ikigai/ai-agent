import { emitAndRun } from "@/lib/agent/runner";
import { DEMO_IDS } from "@/lib/demo/ids";
import { fail, handleError, ok } from "@/lib/http";

// POST /api/matches: deterministic ranking + explanations (demo steps 2-4).
export async function POST() {
  try {
    const id = DEMO_IDS.pema;
    const outcome = await emitAndRun({
      event_type: "mentor.match.requested",
      entity_type: "entrepreneur",
      entity_id: id,
      entrepreneur_id: id,
    });
    if (outcome.status === "failed") {
      const code = outcome.error?.startsWith("ASSESSMENT_REQUIRED") ? "ASSESSMENT_REQUIRED" : "AGENT_FAILED";
      return fail(code === "ASSESSMENT_REQUIRED" ? 409 : 500, code, outcome.error ?? "Matching failed.");
    }
    return ok({ outcome });
  } catch (err) {
    return handleError(err);
  }
}
