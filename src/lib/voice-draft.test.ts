import { describe, expect, it } from "vitest";
import { AssessmentInputSchema } from "./agent/schemas";
import { draftToAnswers, isComplete, mergeAnswers, statusesFor, stillNeeded, toAssessmentInput, withDefaults } from "./voice-draft";

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

describe("voice intro extras (only when said)", () => {
  it("are empty when not said, and saved as nothing", () => {
    const a = draftToAnswers({ goals: [], expertise_needs: [], languages: [], suggested_fields: [] });
    expect([a.progress_so_far, a.vision, a.timeframe, a.mentoring_format]).toEqual(["", "", "", ""]);
    const input = toAssessmentInput({ ...pemaDraft, progress_so_far: "", vision: "", timeframe: "", mentoring_format: "" });
    expect(input).toMatchObject({ progress_so_far: "", vision: "", timeframe: null, mentoring_format: null });
  });

  it("are saved when said", () => {
    const input = toAssessmentInput({ ...pemaDraft, progress_so_far: " Itinerary ready ", vision: "Families host visitors", timeframe: "3 months", mentoring_format: "online" });
    expect(input).toMatchObject({ progress_so_far: "Itinerary ready", vision: "Families host visitors", timeframe: "3 months", mentoring_format: "online" });
    expect(AssessmentInputSchema.safeParse(input).success).toBe(true);
  });
});

describe("what is still needed before the agent finds a mentor", () => {
  it("lists the gaps a rule-based reading leaves, in the order they are asked, until they are answered", () => {
    // A real intro read without AI: the challenge and the help were heard, the rest was not.
    const answers = draftToAnswers({ goals: [], expertise_needs: ["pricing"], languages: ["en"], preferred_language: "en", budget: 0, primary_challenge: "I don't know how to price my coffee.", suggested_fields: [] });
    expect(stillNeeded(answers)).toEqual(["business_stage", "sector", "business_description"]);
    expect(isComplete(answers)).toBe(false);
    const answered = { ...answers, business_stage: "idea" as const, sector: "retail", business_description: "I want to open a small coffee shop." };
    expect(stillNeeded(answered)).toEqual([]);
    expect(isComplete(answered)).toBe(true);
  });

  it("a preferred language they do not speak is still needed", () => {
    expect(stillNeeded({ ...pemaDraft, preferred_language: "dz", languages: ["en"] })).toEqual(["preferred_language"]);
  });
});

describe("the voice intro never blocks the mentor search", () => {
  it("every gap gets a default marked Assumed, so it is complete and saves", () => {
    const { answers, assumed } = withDefaults(draftToAnswers({ goals: [], expertise_needs: [], languages: [], suggested_fields: [] }), "I want to open a small coffee shop.");
    expect(isComplete(answers)).toBe(true);
    expect(answers.business_description).toBe("I want to open a small coffee shop.");
    expect(assumed).toEqual(expect.arrayContaining(["business_stage", "sector", "expertise_needs", "business_description", "primary_challenge"]));
    expect(AssessmentInputSchema.safeParse(toAssessmentInput(answers)).success).toBe(true);
  });
});
