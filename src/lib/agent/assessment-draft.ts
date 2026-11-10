import "server-only";
import type { ResultSource } from "../types";
import { aiStep } from "./ai";
import { groundDraft, missingFields, ruleDraft, type DraftField } from "./assessment-rules";
import { live } from "./live";
import { rejectGenderedText } from "./prompts";
import { AssessmentDraftSchema, type AssessmentDraft } from "./schemas";

// Spoken self-introduction -> needs-assessment draft (English for now).
// Live AI fills the draft; grounding removes anything not actually said;
// the rule-based reader is the fallback. Nothing is saved here: the
// entrepreneur reviews the form and submits it as usual.

export interface DraftResult {
  draft: AssessmentDraft;
  missing: DraftField[];
  source: ResultSource;
}

export async function draftAssessment(transcript: string): Promise<DraftResult> {
  const step = await aiStep({
    task: "assessment_from_speech",
    schema: AssessmentDraftSchema,
    fallback: () => ruleDraft(transcript),
    live: live.assessmentDraft(transcript),
    validate: rejectGenderedText,
    timeoutMs: 15_000,
  });
  const draft = step.source === "live_ai" ? groundDraft(step.value, transcript) : step.value;
  return { draft, missing: missingFields(draft), source: step.source };
}
