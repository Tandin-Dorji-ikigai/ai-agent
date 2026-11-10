import { describe, expect, it } from "vitest";
import { AssessmentInputSchema } from "./agent/schemas";
import { PEMA_ASSESSMENT_ANSWERS } from "./demo/fixtures";
import { assessmentFromForm, isExploring, profileFromEntrepreneur } from "./mentorflow-assessment";
import type { EntrepreneurRecord } from "./types";

const entrepreneur: EntrepreneurRecord = {
  id: "demo", full_name: "Pema", location: "Thimphu",
  assessment_summary: null, assessment_completed_at: null,
  ...PEMA_ASSESSMENT_ANSWERS,
};
const needs = PEMA_ASSESSMENT_ANSWERS.expertise_needs;

describe("prototype form to assessment API", () => {
  it("round-trips a saved assessment without changing matching inputs", () => {
    const input = assessmentFromForm(profileFromEntrepreneur(entrepreneur), needs);
    expect(AssessmentInputSchema.parse(input)).toEqual(PEMA_ASSESSMENT_ANSWERS);
  });

  it.each(["idea", "early", "growth", "established"] as const)("preserves the saved %s stage", stage => {
    const form = profileFromEntrepreneur({ ...entrepreneur, business_stage: stage });
    expect(assessmentFromForm(form, needs).business_stage).toBe(stage);
  });

  it("keeps the preferred language within the selected languages", () => {
    const form = { ...profileFromEntrepreneur(entrepreneur), language: "English", languagePreference: "Dzongkha" };
    const input = assessmentFromForm(form, needs);
    expect(input.languages).toContain(input.preferred_language);
    expect(AssessmentInputSchema.safeParse(input).success).toBe(true);
  });

  it("rejects unsupported industries instead of assigning a different sector", () => {
    expect(() => assessmentFromForm({ ...profileFromEntrepreneur(entrepreneur), industry: "Education" }, needs)).toThrow("supported industry");
  });

  it("requires explicit support areas for deterministic matching", () => {
    expect(() => assessmentFromForm(profileFromEntrepreneur(entrepreneur), [])).toThrow("one and five");
  });

  it("submits exploratory onboarding without requiring an invented business", () => {
    const form = { ...profileFromEntrepreneur(entrepreneur), interests: "Agriculture & Food", strengths: "Growing vegetables", motivation: "Create a local enterprise", challenge: "" };
    const input = assessmentFromForm(form, needs, true);
    expect(AssessmentInputSchema.safeParse(input).success).toBe(true);
    expect(input.business_stage).toBe("idea");
    expect(input.sector).toBe("agriculture");
    expect(input.business_description).toContain("Growing vegetables");
  });

  it("does not invent a business name for someone still exploring", () => {
    const form = { ...profileFromEntrepreneur(entrepreneur), interests: "Agriculture & Food", strengths: "Growing vegetables", motivation: "", challenge: "" };
    expect(assessmentFromForm(form, needs, true).business_name).toBe("");
  });

  it("keeps an exploring entrepreneur's saved sector and words when the form is saved again", () => {
    const saved = { ...entrepreneur, business_name: "", business_stage: "idea" as const, sector: "agriculture", business_description: "Growing vegetables" };
    expect(isExploring(saved)).toBe(true);
    const again = assessmentFromForm(profileFromEntrepreneur(saved), needs, true);
    expect(again.sector).toBe("agriculture");
    expect(again.business_description).toBe("Growing vegetables");
  });
});
