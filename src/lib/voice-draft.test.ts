import { describe, expect, it } from "vitest";
import { AssessmentInputSchema } from "./agent/schemas";
import { draftToAnswers, isComplete, mergeAnswers, statusesFor, toAssessmentInput, withDefaults } from "./voice-draft";

const pemaDraft = draftToAnswers({
  business_name: "Yangchen Village Walks and Homestay",
  business_stage: "early",
  sector: "tourism",
  business_description: "Two homestay rooms and a half-day village walk outside Thimphu.",
  primary_challenge: "I do not know who my guests are.",
  goals: [],
  expertise_needs: ["customer_validation", "pricing"],
  languages: ["dz", "en"],
  preferred_language: "dz",
  budget: 1500,
  suggested_fields: [],
});

describe("voice intro answers", () => {
  it("a full intro is complete and saves as a valid assessment", () => {
    expect(isComplete(pemaDraft)).toBe(true);
    expect(AssessmentInputSchema.safeParse(toAssessmentInput(pemaDraft)).success).toBe(true);
  });

  it("small gaps get safe defaults marked Assumed (budget not sure, language spoken)", () => {
    const { answers, assumed } = withDefaults({ ...pemaDraft, budget: "", languages: [], preferred_language: "" });
    expect(answers.budget).toBe(0);
    expect(answers.languages).toEqual(["en"]);
    expect(answers.preferred_language).toBe("en");
    expect(assumed.sort()).toEqual(["budget", "languages", "preferred_language"]);
    expect(isComplete(answers)).toBe(true);
  });

  it("labels each answer heard, suggested, assumed or missing", () => {
    const s = statusesFor({ ...pemaDraft, primary_challenge: "" }, ["primary_challenge"], ["sector"], ["budget"]);
    expect(s).toMatchObject({ business_name: "heard", sector: "suggested", budget: "assumed", primary_challenge: "missing" });
  });

  it("answering by voice again fills only what is empty or assumed, never what was heard", () => {
    const current = { ...pemaDraft, primary_challenge: "", budget: 0 as const };
    const status = statusesFor(current, ["primary_challenge"], [], ["budget"]);
    const incoming = { ...pemaDraft, business_name: "Another name", primary_challenge: "Pricing the walk", budget: 1000 };
    const merged = mergeAnswers(current, status, incoming, statusesFor(incoming, [], [], []));
    expect(merged.answers.business_name).toBe("Yangchen Village Walks and Homestay");
    expect(merged.answers.primary_challenge).toBe("Pricing the walk");
    expect(merged.answers.budget).toBe(1000);
    expect(merged.status.budget).toBe("heard");
  });
});
