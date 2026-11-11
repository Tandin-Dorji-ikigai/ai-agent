import type { AssessmentInput } from "./agent/schemas";
import type { EntrepreneurRecord } from "./types";
import { MENTORING_FORMAT_LABEL, SECTOR_LABEL, TIMEFRAMES, type MentoringFormat, type Timeframe } from "./types";

/** The form shows the labels; the API stores the keys. */
const FORMAT_FROM_LABEL = Object.fromEntries(Object.entries(MENTORING_FORMAT_LABEL).map(([key, label]) => [label, key])) as Record<string, MentoringFormat>;

export const INDUSTRY_SECTORS: Record<string, AssessmentInput["sector"]> = {
  "Tourism & Hospitality": "tourism", "Agriculture & Food": "agriculture",
  Handicrafts: "handicrafts", Retail: "retail", "Finance & Fintech": "fintech",
  "Technology & AI": "technology", "Not decided yet": "undecided",
};
export const FORM_STAGES: Record<string, AssessmentInput["business_stage"]> = {
  Idea: "idea", Validation: "early", Prototype: "early", "MVP / Pilot": "early",
  Launched: "early", Growth: "growth", Established: "established",
};

/** Someone with no business yet: idea stage and no business name (the backend allows an empty name for this). */
export function isExploring(entrepreneur: Pick<EntrepreneurRecord, "business_name" | "business_stage"> | null | undefined): boolean {
  return !!entrepreneur && entrepreneur.business_stage === "idea" && !entrepreneur.business_name;
}

export function profileFromEntrepreneur(entrepreneur: EntrepreneurRecord) {
  const industry = Object.keys(INDUSTRY_SECTORS).find(label => INDUSTRY_SECTORS[label] === entrepreneur.sector) ?? "";
  return {
    // The "exploring" form reads these back, so saving again keeps what was saved.
    interests: industry,
    strengths: entrepreneur.business_description ?? "",
    motivation: "",
    fullName: entrepreneur.full_name,
    district: entrepreneur.location ?? "",
    language: entrepreneur.preferred_language === "dz" ? "Dzongkha" : "English",
    languagePreference: entrepreneur.languages.length > 1 ? "Either" : entrepreneur.languages[0] === "dz" ? "Dzongkha" : "English",
    productName: entrepreneur.business_name ?? "",
    industry: Object.keys(INDUSTRY_SECTORS).find(label => INDUSTRY_SECTORS[label] === entrepreneur.sector) ?? SECTOR_LABEL[entrepreneur.sector as keyof typeof SECTOR_LABEL] ?? "",
    stage: ({ idea: "Idea", early: "Validation", growth: "Growth", established: "Established" })[entrepreneur.business_stage ?? "idea"],
    description: entrepreneur.business_description ?? "",
    challenge: entrepreneur.primary_challenge ?? "",
    goal: entrepreneur.goals.join("\n"),
    budget: String(entrepreneur.budget),
    currentState: entrepreneur.progress_so_far ?? "",
    vision: entrepreneur.vision ?? "",
    timeframe: entrepreneur.timeframe ?? "",
    mode: entrepreneur.mentoring_format ? MENTORING_FORMAT_LABEL[entrepreneur.mentoring_format] : "",
  };
}

// Translate the supplied prototype's field names to the existing API contract.
// Unknown options are rejected instead of silently assigning another sector.
export function assessmentFromForm(
  values: Record<string, string>, expertiseNeeds: string[], exploring = false,
): AssessmentInput {
  // Nothing blocks finding a mentor: a blank answer gets a safe default the mentee can change later.
  const sector = INDUSTRY_SECTORS[exploring ? values.interests : values.industry] ?? "undecided";
  const stage = exploring ? "idea" : FORM_STAGES[values.stage] ?? "early";
  if (expertiseNeeds.length > 5) throw new Error("Choose up to five areas of mentorship support.");
  if (!expertiseNeeds.length) expertiseNeeds = [sector === "undecided" ? "idea_development" : "market_positioning"];
  const preferred = values.language === "English" ? "en" : "dz";
  const language: AssessmentInput["languages"] = values.languagePreference === "Either" ? ["dz", "en"]
    : [values.languagePreference === "English" ? "en" : "dz"];
  const languages = [...new Set<AssessmentInput["preferred_language"]>([...language, preferred])];
  return {
    // No made-up business name for someone still exploring (it would reach mentors and the agent).
    business_name: exploring ? "" : values.productName?.trim() ?? "",
    business_stage: stage,
    sector,
    // The interest is already the sector; the description keeps only their own words.
    business_description: exploring ? [values.strengths, values.motivation].map(v => v?.trim()).filter(Boolean).join(" ") || "I am exploring business ideas." : values.description?.trim() || "I would like to talk my plans through with a mentor.",
    primary_challenge: values.challenge?.trim() || (exploring ? "I need help finding and validating a business idea." : "I would like a mentor's advice on what to do next."),
    goals: (values.goal ?? "").split("\n").map(goal => goal.trim()).filter(Boolean),
    expertise_needs: expertiseNeeds as AssessmentInput["expertise_needs"],
    languages,
    preferred_language: preferred,
    budget: Number(values.budget) || 0,
    // Optional extras (the no-idea form asks only when and how to meet).
    progress_so_far: exploring ? "" : values.currentState?.trim() ?? "",
    vision: exploring ? "" : values.vision?.trim() ?? "",
    timeframe: (TIMEFRAMES as readonly string[]).includes(values.timeframe) ? (values.timeframe as Timeframe) : null,
    mentoring_format: FORMAT_FROM_LABEL[values.mode] ?? null,
  };
}
