import { emitAndRun } from "@/lib/agent/runner";
import { AssessmentInputSchema } from "@/lib/agent/schemas";
import { demoNow } from "@/lib/clock";
import { DEMO_IDS } from "@/lib/demo/ids";
import { fail, handleError, ok, parseBody } from "@/lib/http";
import { db, must } from "@/lib/supabase/server";

// POST /api/assessment: Pema submits her needs assessment (demo step 1).
// The platform saves the structured answers; the agent writes the summary.
export async function POST(req: Request) {
  const body = await parseBody(req, AssessmentInputSchema);
  if ("error" in body) return body.error;
  const input = body.data;
  if (!input.languages.includes(input.preferred_language)) {
    return fail(400, "INVALID_INPUT", "The preferred language must be one of the selected languages.");
  }
  try {
    const now = await demoNow();
    const id = DEMO_IDS.pema;
    must(
      await db().from("profiles").update({ preferred_language: input.preferred_language }).eq("id", id).select("id"),
      "save language",
    );
    const saved = must(
      await db()
        .from("entrepreneur_profiles")
        .update({
          business_name: input.business_name || null,
          business_stage: input.business_stage,
          sector: input.sector,
          business_description: input.business_description,
          primary_challenge: input.primary_challenge,
          goals: input.goals,
          expertise_needs: input.expertise_needs,
          languages: input.languages,
          budget: input.budget,
          assessment_completed_at: now.toISOString(),
          updated_at: now.toISOString(),
        })
        .eq("user_id", id)
        .select("user_id"),
      "save assessment",
    ) as Array<{ user_id: string }>;
    if (saved.length === 0) return fail(409, "NOT_SEEDED", "Demo data is missing. Reset the demo first.");

    const outcome = await emitAndRun({
      event_type: "assessment.completed",
      entity_type: "entrepreneur",
      entity_id: id,
      entrepreneur_id: id,
    });
    return ok({ outcome });
  } catch (err) {
    return handleError(err);
  }
}
