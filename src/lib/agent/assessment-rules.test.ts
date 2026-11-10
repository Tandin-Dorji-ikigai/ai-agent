import { describe, expect, it } from "vitest";
import { DEMO_VOICE_INTRO, PEMA_ASSESSMENT_ANSWERS } from "../demo/fixtures";
import { cleanSentence, groundDraft, missingFields, parseBudget, parseBusinessName, ruleDraft, wordsToNumber } from "./assessment-rules";
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
    expect(missingFields(d)).toContain("budget");
    expect(missingFields(d)).not.toContain("business_name"); // optional
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
      { business_name: "Bumthang Apple Co", budget: 2000, languages: ["dz", "en"], preferred_language: "dz", goals: [], expertise_needs: [], suggested_fields: [] },
      said,
    );
    expect(grounded.business_name).toBeUndefined();
    expect(grounded.budget).toBeUndefined();
    expect(grounded.languages).toEqual(["en"]);
    // Dzongkha was never said, so it goes; English is the only language named, so it becomes the preference.
    expect(grounded.preferred_language).toBe("en");
  });

  it("keeps what was said", () => {
    const grounded = groundDraft(
      { business_name: "Yangchen Village Walks and Homestay", budget: 1500, languages: ["dz", "en"], preferred_language: "dz", goals: [], expertise_needs: [], suggested_fields: [] },
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
    const g = groundDraft({ languages: ["dz", "en"], preferred_language: "dz", budget: 1500, goals: [], expertise_needs: [], suggested_fields: [] }, heard);
    expect(g).toMatchObject({ languages: ["dz", "en"], preferred_language: "dz", budget: 1500 });
  });
});

describe("aspiring entrepreneurs with no business yet", () => {
  // Based on a real test recording (name changed).
  const aspiring =
    "Hello, hello. My name is Sangay and I'm an aspiring entrepreneur. I want to get insights on how I can get into this entrepreneur field " +
    "and then work on my ideas. I'm new to entrepreneurship. I have no idea. I don't have my business idea. But as I learn the life cycle of " +
    "entrepreneurship, I can use it to generate an idea and use it as my startup base.";

  it("infers the idea stage, an undecided sector and the need to find an idea, marked as suggestions", () => {
    const d = ruleDraft(aspiring);
    expect(d).toMatchObject({ business_stage: "idea", sector: "undecided", languages: ["en"] });
    expect(d.expertise_needs).toContain("idea_development");
    expect(d.business_description).toMatch(/aspiring entrepreneur/i);
    expect(d.primary_challenge).toBeTruthy();
    expect(d.suggested_fields).toEqual(
      expect.arrayContaining(["business_stage", "sector", "expertise_needs", "languages", "business_description", "primary_challenge"]),
    );
  });

  it("only asks for what cannot be inferred: preferred language and budget", () => {
    expect(missingFields(ruleDraft(aspiring)).sort()).toEqual(["budget", "preferred_language"]);
  });

  it("never invents a business name or budget", () => {
    const d = ruleDraft(aspiring);
    expect(d.business_name).toBeUndefined();
    expect(d.budget).toBeUndefined();
  });

  it("grounding keeps English as a suggestion when no language was named", () => {
    const g = groundDraft({ languages: [], goals: [], expertise_needs: ["idea_development"], suggested_fields: [] }, aspiring);
    expect(g.languages).toEqual(["en"]);
    expect(g.suggested_fields).toContain("languages");
  });
});

describe("checks found in live testing", () => {
  const realStyle =
    "Hello, hello. My name is Sangay and I'm an aspiring entrepreneur. So currently I'm using this platform. " +
    "I want to get insights on how I can get into this entrepreneur field. I don't have my business idea.";

  it("does not treat 'using this platform' as a technology business", () => {
    expect(ruleDraft(realStyle).sector).toBe("undecided");
  });

  it("grounding replaces an unsupported sector for someone with no business", () => {
    const g = groundDraft({ sector: "technology", languages: ["en"], goals: [], expertise_needs: [], suggested_fields: [] }, realStyle);
    expect(g.sector).toBe("undecided");
    expect(g.suggested_fields).toContain("sector");
  });

  it("keeps a supported sector as heard", () => {
    const g = groundDraft({ sector: "tourism", languages: [], goals: [], expertise_needs: [], suggested_fields: [] }, DEMO_VOICE_INTRO);
    expect(g.sector).toBe("tourism");
    expect(g.suggested_fields).not.toContain("sector");
  });

  it("one language named means that is the preference", () => {
    const g = groundDraft({ languages: ["en"], goals: [], expertise_needs: [], suggested_fields: [] }, "I am a student. I speak English.");
    expect(g.preferred_language).toBe("en");
  });
});

describe("descriptions without small talk", () => {
  it("drops greetings and the name", () => {
    expect(cleanSentence("Hello hello, my name is Songhai and I'm an aspiring entrepreneur.")).toBe("I'm an aspiring entrepreneur.");
    expect(cleanSentence("So currently I'm new to entrepreneurship.")).toBe("Currently I'm new to entrepreneurship.");
  });
  it("the aspiring draft's description starts with the content", () => {
    const d = ruleDraft("Hello, hello. My name is Sangay and I'm an aspiring entrepreneur. I don't have my business idea.");
    expect(d.business_description).toMatch(/^I'm an aspiring entrepreneur\./);
    expect(d.business_description).not.toMatch(/hello|Sangay/i);
  });
});

describe("what was said outright is 'Heard', not 'Suggested'", () => {
  it("keeps the label for real inferences, clears it for words the person said", async () => {
    const { groundDraft } = await import("./assessment-rules");
    const transcript =
      "Hello, my name is Pema. I run Yangchen Village Walks and Homestay outside Thimphu. We have two homestay rooms and a half-day guided walk. " +
      "My biggest challenge is that I don't really know who my guests are. I speak Dzongkha and English, but I prefer Dzongkha. My budget is about 1,500 ngultrum per session.";
    const out = groundDraft(
      {
        business_name: "Yangchen Village Walks and Homestay",
        business_stage: "early",
        sector: "tourism",
        business_description: "Two homestay rooms and a half-day guided walk outside Thimphu.",
        primary_challenge: "I don't really know who my guests are.",
        goals: [],
        expertise_needs: ["customer_validation"],
        languages: ["dz", "en"],
        preferred_language: "dz",
        budget: 1500,
        // The model marked everything as a suggestion.
        suggested_fields: ["business_name", "sector", "business_stage", "business_description", "primary_challenge", "expertise_needs", "languages", "preferred_language", "budget"],
      },
      transcript,
    );
    expect(out.suggested_fields.sort()).toEqual(["business_stage", "expertise_needs"]);
  });
});
