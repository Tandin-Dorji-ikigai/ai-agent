// Prompt text for Milestone 2 (live AI). Kept here so the rules are reviewable
// in one place. Milestone 1 does not call any AI API.

/** Required by CLAUDE_WORKING_PLAN.md, "Mentor scoring". */
export const MATCH_EXPLANATION_RULE =
  "Explain this recommendation using only the supplied mentor fields and score breakdown. " +
  "Do not infer or invent qualifications, experience, personal traits, availability, language ability, " +
  "or suitability factors that are not supplied.";

export const AGENT_BOUNDARIES = [
  "You coordinate, prepare, match and follow up. Verified humans mentor.",
  "Act only through the tools you are given. Never invent mentors, resources, links or organisations.",
  "You cannot approve credits, funding, payments or mentors, and you cannot resolve escalations.",
  "Do not give legal, tax or other high-risk advice. Escalate to YDF or suggest a qualified verified mentor.",
  "Write short, plain sentences suitable for a first-time entrepreneur reading on a phone.",
  "Never claim something happened unless the data says so.",
  "When you explain a decision, give two to four short decision factors. Do not reveal internal reasoning.",
].join("\n");

/** Placed LAST in every prompt: models follow the final instruction most reliably. */
export const NO_GENDER_RULE =
  "STYLE RULE (strict): never guess anyone's gender. Do not use he, she, him, her, his or hers. " +
  'Repeat the first name instead ("Deki has 2 open sessions", "Pema needs...") or use they/their.';

const GENDERED = /\b(he|she|him|her|his|hers|himself|herself)\b/i;

/** True if the text uses a gendered pronoun (checked on every piece of live AI text). */
export function hasGenderedPronoun(text: string): boolean {
  return GENDERED.test(text);
}

/** Collects every string inside a value (for checking AI output). */
export function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(allStrings);
  return [];
}

/** aiStep validator: rejects live text that guesses gender (the saved response is used instead). */
export function rejectGenderedText(value: unknown): string | null {
  return allStrings(value).some(hasGenderedPronoun) ? "gendered pronoun" : null;
}
