import { describe, expect, it } from "vitest";
import { hasGenderedPronoun, rejectGenderedText } from "./prompts";

describe("gender-neutral text check", () => {
  it("flags gendered pronouns as whole words only", () => {
    expect(hasGenderedPronoun("She has 2 open sessions.")).toBe(true);
    expect(hasGenderedPronoun("Fill her rooms in low season")).toBe(true);
    expect(hasGenderedPronoun("Deki has 2 open sessions and shelters guests; the theme is heritage.")).toBe(false);
    expect(hasGenderedPronoun("They have the right expertise.")).toBe(false);
  });

  it("checks every string inside nested AI output", () => {
    expect(rejectGenderedText({ a: ["fine", { b: "his notes" }] })).toBe("gendered pronoun");
    expect(rejectGenderedText({ a: ["fine", { b: "their notes" }] })).toBeNull();
  });
});
