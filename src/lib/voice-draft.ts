// The voice intro's answers, between "the agent understood your speech" and
// "saved". Pure (no React, no API), so it is unit-tested.

import type { AssessmentDraft, AssessmentInput, DraftField } from "./agent/schemas";
import type { Expertise, Language, MentoringFormat, Stage, Timeframe } from "./types";

/** The assessment as answers that may still be incomplete. */
export interface DraftAnswers {
  business_name: string;
  business_stage: Stage | "";
  sector: string;
  business_description: string;
  primary_challenge: string;
  goals: string[];
  expertise_needs: Expertise[];
  languages: Language[];
  preferred_language: Language | "";
  budget: number | "";
  /** Optional extras, only when said. */
  progress_so_far: string;
  vision: string;
  timeframe: Timeframe | "";
  mentoring_format: MentoringFormat | "";
}

/** How the agent got each answer: said outright, inferred from meaning, a safe default, or not said. */
export type AnswerStatus = "heard" | "suggested" | "assumed" | "missing";

export const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

export function draftToAnswers(d: AssessmentDraft): DraftAnswers {
  return {
    business_name: d.business_name ?? "",
    sector: d.sector ?? "",
    business_stage: d.business_stage ?? "",
    business_description: d.business_description ?? "",
    primary_challenge: d.primary_challenge ?? "",
    goals: d.goals ?? [],
    expertise_needs: (d.expertise_needs ?? []) as Expertise[],
    languages: d.languages ?? [],
    preferred_language: d.preferred_language ?? "",
    budget: d.budget ?? "",
    progress_so_far: d.progress_so_far ?? "",
    vision: d.vision ?? "",
    timeframe: d.timeframe ?? "",
    mentoring_format: d.mentoring_format ?? "",
  };
}

/** Enough to save and find a mentor. */
export function isComplete(a: DraftAnswers): boolean {
  return (
    a.sector !== "" &&
    a.business_stage !== "" &&
    a.business_description.trim() !== "" &&
    a.primary_challenge.trim() !== "" &&
    a.expertise_needs.length > 0 &&
    a.expertise_needs.length <= 5 &&
    a.languages.length > 0 &&
    a.preferred_language !== "" &&
    a.languages.includes(a.preferred_language as Language) &&
    a.budget !== ""
  );
}

/** Safe defaults for small gaps, so the agent can go ahead; each is labelled "Assumed". */
export function withDefaults(a: DraftAnswers): { answers: DraftAnswers; assumed: DraftField[] } {
  const next = { ...a, languages: [...a.languages] };
  const assumed: DraftField[] = [];
  if (next.languages.length === 0) {
    next.languages = ["en"]; // the intro was spoken in English
    assumed.push("languages");
  }
  if (!next.preferred_language) {
    next.preferred_language = next.languages.length === 1 ? next.languages[0] : "en";
    if (!next.languages.includes(next.preferred_language)) next.languages.push(next.preferred_language);
    assumed.push("preferred_language");
  }
  if (next.budget === "") {
    next.budget = 0; // "not sure": neutral in matching; YDF credit can cover fees
    assumed.push("budget");
  }
  return { answers: next, assumed };
}

/** Status of every field after a draft, given what the server said was missing or only suggested. */
export function statusesFor(answers: DraftAnswers, missing: DraftField[], suggested: DraftField[], assumed: DraftField[]): Partial<Record<DraftField, AnswerStatus>> {
  const out: Partial<Record<DraftField, AnswerStatus>> = {};
  for (const f of Object.keys(answers) as Array<keyof DraftAnswers>) {
    if (f === "goals") continue;
    const field = f as DraftField;
    out[field] = assumed.includes(field) ? "assumed" : missing.includes(field) || isEmpty(answers[f]) ? "missing" : suggested.includes(field) ? "suggested" : "heard";
  }
  return out;
}

/** "Answer by voice" again: fill only what is still empty or was assumed. */
export function mergeAnswers(
  current: DraftAnswers,
  status: Partial<Record<DraftField, AnswerStatus>>,
  incoming: DraftAnswers,
  incomingStatus: Partial<Record<DraftField, AnswerStatus>>,
): { answers: DraftAnswers; status: Partial<Record<DraftField, AnswerStatus>> } {
  const answers = { ...current };
  const nextStatus = { ...status };
  for (const f of Object.keys(incoming) as Array<keyof DraftAnswers>) {
    if (f === "goals") continue;
    const field = f as DraftField;
    if ((isEmpty(answers[f]) || nextStatus[field] === "assumed") && !isEmpty(incoming[f])) {
      (answers as Record<string, unknown>)[f] = incoming[f];
      nextStatus[field] = incomingStatus[field] ?? "heard";
    }
  }
  if (answers.preferred_language && !answers.languages.includes(answers.preferred_language as Language)) {
    answers.languages = [...answers.languages, answers.preferred_language as Language];
  }
  return { answers, status: nextStatus };
}

/** Complete answers as the assessment API expects them. */
export function toAssessmentInput(a: DraftAnswers): AssessmentInput {
  return {
    business_name: a.business_name.trim(),
    business_stage: a.business_stage as Stage,
    sector: a.sector as AssessmentInput["sector"],
    business_description: a.business_description.trim(),
    primary_challenge: a.primary_challenge.trim(),
    goals: a.goals.map((g) => g.trim()).filter(Boolean),
    expertise_needs: a.expertise_needs,
    languages: a.languages,
    preferred_language: a.preferred_language as Language,
    budget: Number(a.budget),
    progress_so_far: a.progress_so_far.trim(),
    vision: a.vision.trim(),
    timeframe: a.timeframe || null,
    mentoring_format: a.mentoring_format || null,
  };
}
