import { describe, expect, it } from "vitest";
import { DEMO_VOICE_INTRO, PEMA_ASSESSMENT_ANSWERS } from "../demo/fixtures";
import { groundDraft, missingFields, parseBudget, parseBusinessName, ruleDraft, wordsToNumber } from "./assessment-rules";
import { AssessmentDraftSchema } from "./schemas";

describe("numbers and budgets in speech", () => {
  it.each([
    ["one thousand five hundred", 1500],
    ["fifteen hundred", 1500],
    ["two thousand", 2000],
    ["five hundred", 500],
    ["twenty five", 25],
  ])("%s -> %s", (words, n) => {
    expect(wordsToNumber(words)).toBe(n);
  });

  it.each([
    ["I can spend about one thousand five hundred ngultrum per session.", 1500],
    ["My budget is around 500 ngultrum a session.", 500],
    ["Maybe Nu. 1,200 each time.", 1200],
    ["I have no idea about money yet.", null],
  ])("%s -> %s", (text, n) => {
    expect(parseBudget(text)).toBe(n);
  });

  it("reads a business name only when it is said", () => {
    expect(parseBusinessName("I run Yangchen Village Walks and Homestay, outside Thimphu.")).toBe("Yangchen Village Walks and Homestay");
    expect(parseBusinessName("I grow vegetables near Punakha.")).toBeNull();
  });
});

describe("rule-based draft from a spoken introduction", () => {
  it("drafts Pema's intro the same as her typed answers", () => {
    const d = ruleDraft(DEMO_VOICE_INTRO);
    expect(AssessmentDraftSchema.safeParse(d).success).toBe(true);
    expect(d).toMatchObject({
      business_name: "Yangchen Village Walks and Homestay",
      sector: "tourism",
      business_stage: "early",
      languages: ["dz", "en"],
      preferred_language: "dz",
      budget: 1500,
    });
    expect([...d.expertise_needs].sort()).toEqual([...PEMA_ASSESSMENT_ANSWERS.expertise_needs].sort());
    expect(missingFields(d)).toEqual([]);
  });

  it("leaves out what a farmer did not say (no invented name or budget)", () => {
    const d = ruleDraft(
      "Hi, I'm Karma. I grow vegetables and keep a few cows near Punakha. I sell cheese and spinach at the weekend market. " +
        "The problem is that shops pay me very little, and I don't know how to price the cheese. I only speak Dzongkha.",
    );
    expect(d.sector).toBe("agriculture");
    expect(d.expertise_needs).toContain("pricing");
    expect(d.languages).toEqual(["dz"]);
    expect(d.preferred_language).toBe("dz");
    expect(d.business_name).toBeUndefined();
    expect(d.budget).toBeUndefined();
    expect(missingFields(d)).toEqual(expect.arrayContaining(["business_name", "budget"]));
  });

  it("recognises an idea-stage student", () => {
    const d = ruleDraft(
      "My name is Sonam, I'm a student in Kanglung. I have an idea for a mobile app that lets farmers sell directly to hotels. " +
        "I haven't started yet. I need help building the app and with funding. I speak English. My budget is around 500 ngultrum a session.",
    );
    expect(d).toMatchObject({ sector: "technology", business_stage: "idea", languages: ["en"], preferred_language: "en", budget: 500 });
    expect(d.expertise_needs).toEqual(expect.arrayContaining(["product_development", "fundraising"]));
  });
});

describe("grounding the live AI draft", () => {
  it("removes a name, budget or language that was never said", () => {
    const said = "I grow apples in Bumthang. I speak English.";
    const grounded = groundDraft(
      { business_name: "Bumthang Apple Co", budget: 2000, languages: ["dz", "en"], preferred_language: "dz", goals: [], expertise_needs: [] },
      said,
    );
    expect(grounded.business_name).toBeUndefined();
    expect(grounded.budget).toBeUndefined();
    expect(grounded.languages).toEqual(["en"]);
    expect(grounded.preferred_language).toBeUndefined();
  });

  it("keeps what was said", () => {
    const grounded = groundDraft(
      { business_name: "Yangchen Village Walks and Homestay", budget: 1500, languages: ["dz", "en"], preferred_language: "dz", goals: [], expertise_needs: [] },
      DEMO_VOICE_INTRO,
    );
    expect(grounded).toMatchObject({ business_name: "Yangchen Village Walks and Homestay", budget: 1500, preferred_language: "dz" });
  });
});

describe("speech-to-text misspellings", () => {
  const heard =
    "I run Yangchen Village Walks and Homestay. I speak Zonka and English, and I prefer Zonka. I can spend about 1,500 Gultrim per session.";
  it("reads 'Zonka' as Dzongkha and 'Gultrim' as ngultrum", () => {
    const d = ruleDraft(heard);
    expect(d.languages).toEqual(["dz", "en"]);
    expect(d.preferred_language).toBe("dz");
    expect(d.budget).toBe(1500);
  });
  it("keeps Dzongkha when grounding a live draft from such a transcript", () => {
    const g = groundDraft({ languages: ["dz", "en"], preferred_language: "dz", budget: 1500, goals: [], expertise_needs: [] }, heard);
    expect(g).toMatchObject({ languages: ["dz", "en"], preferred_language: "dz", budget: 1500 });
  });
});
