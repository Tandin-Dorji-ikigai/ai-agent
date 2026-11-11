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

describe("assessment extras (done so far, how it should work, when, how to meet)", () => {
  const form = {
    productName: "Village walks", industry: "Tourism & Hospitality", stage: "Validation", description: "Guided walks.", challenge: "Finding guests.",
    goal: "Fill the low season", language: "English", languagePreference: "English", budget: "1500",
    currentState: "  A sample itinerary is ready. ", vision: "Families host visitors.", timeframe: "6 months", mode: "Online only",
  };

  it("are saved from the form, with the meeting format as its key", () => {
    const input = assessmentFromForm(form, ["pricing"]);
    expect(input).toMatchObject({ progress_so_far: "A sample itinerary is ready.", vision: "Families host visitors.", timeframe: "6 months", mentoring_format: "online" });
  });

  it("are empty when not filled in, and an unknown choice is not saved", () => {
    const input = assessmentFromForm({ ...form, currentState: "", vision: "", timeframe: "", mode: "Sometimes" }, ["pricing"]);
    expect(input).toMatchObject({ progress_so_far: "", vision: "", timeframe: null, mentoring_format: null });
  });

  it("the no-idea form asks only when and how to meet", () => {
    const input = assessmentFromForm({ interests: "Agriculture & Food", strengths: "Growing food", goal: "Find an idea", timeframe: "Flexible", mode: "In-person only", currentState: "x", vision: "y", language: "English", languagePreference: "English", budget: "0" }, ["idea_development"], true);
    expect(input).toMatchObject({ progress_so_far: "", vision: "", timeframe: "Flexible", mentoring_format: "in_person" });
  });

  it("read back into the form after saving", () => {
    const back = profileFromEntrepreneur({
      id: "e", full_name: "Pema Yangchen", location: null, preferred_language: "en", languages: ["en"], business_name: "Village walks", business_stage: "early",
      sector: "tourism", business_description: "Guided walks.", primary_challenge: "Finding guests.", goals: [], expertise_needs: ["pricing"], budget: 1500,
      progress_so_far: "A sample itinerary is ready.", vision: "Families host visitors.", timeframe: "6 months", mentoring_format: "either",
      assessment_summary: null, assessment_completed_at: null,
    });
    expect(back).toMatchObject({ currentState: "A sample itinerary is ready.", vision: "Families host visitors.", timeframe: "6 months", mode: "Online or in-person" });
  });
});
