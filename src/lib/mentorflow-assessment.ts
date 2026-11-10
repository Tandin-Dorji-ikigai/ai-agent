import type { AssessmentInput } from "./agent/schemas";
import type { EntrepreneurRecord } from "./types";
import { SECTOR_LABEL } from "./types";

export const INDUSTRY_SECTORS: Record<string, AssessmentInput["sector"]> = {
  "Tourism & Hospitality": "tourism", "Agriculture & Food": "agriculture",
  Handicrafts: "handicrafts", Retail: "retail", "Finance & Fintech": "fintech",
  "Technology & AI": "technology",
};
export const FORM_STAGES: Record<string, AssessmentInput["business_stage"]> = {
  Idea: "idea", Validation: "early", Prototype: "early", "MVP / Pilot": "early",
  Launched: "early", Growth: "growth", Established: "established",
};

export function profileFromEntrepreneur(entrepreneur: EntrepreneurRecord) {
  return {
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
  };
}

// Translate the supplied prototype's field names to the existing API contract.
// Unknown options are rejected instead of silently assigning another sector.
export function assessmentFromForm(
  values: Record<string, string>, expertiseNeeds: string[], exploring = false,
): AssessmentInput {
  const sector = INDUSTRY_SECTORS[exploring ? values.interests : values.industry];
  const stage = exploring ? "idea" : FORM_STAGES[values.stage];
  if (!sector) throw new Error("Choose a supported industry so we can match you with a mentor.");
  if (!stage) throw new Error("Choose your current business stage.");
  if (!expertiseNeeds.length || expertiseNeeds.length > 5) throw new Error("Choose between one and five areas of mentorship support.");
  const preferred = values.language === "English" ? "en" : "dz";
  const language: AssessmentInput["languages"] = values.languagePreference === "Either" ? ["dz", "en"]
    : [values.languagePreference === "English" ? "en" : "dz"];
  const languages = [...new Set<AssessmentInput["preferred_language"]>([...language, preferred])];
  return {
    business_name: exploring ? "Exploring my first business idea" : values.productName?.trim() ?? "",
    business_stage: stage,
    sector,
    business_description: exploring ? [values.interests, values.strengths, values.motivation].filter(Boolean).join(". ") : values.description?.trim() ?? "",
    primary_challenge: values.challenge?.trim() || (exploring ? "I need help finding and validating a business idea." : ""),
    goals: (values.goal ?? "").split("\n").map(goal => goal.trim()).filter(Boolean),
    expertise_needs: expertiseNeeds as AssessmentInput["expertise_needs"],
    languages,
    preferred_language: preferred,
    budget: Number(values.budget),
  };
}
