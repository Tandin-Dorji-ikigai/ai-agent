import { draftAssessment } from "@/lib/agent/assessment-draft";
import { AssessmentDraftInputSchema } from "@/lib/agent/schemas";
import { handleError, ok, parseBody } from "@/lib/http";

// POST /api/assessment/draft { transcript } -> { draft, missing, source }
// The agent understands a spoken self-introduction and drafts the needs
// assessment. Saves nothing: the entrepreneur checks the form and submits it.
export async function POST(req: Request) {
  const body = await parseBody(req, AssessmentDraftInputSchema);
  if ("error" in body) return body.error;
  try {
    return ok(await draftAssessment(body.data.transcript));
  } catch (err) {
    return handleError(err);
  }
}
