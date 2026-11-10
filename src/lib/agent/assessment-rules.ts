// Rule-based reading of a spoken self-introduction into a needs-assessment
// draft. The fallback when live AI is off or fails, and the grounding check for
// the live answer (a name or budget the person never said is removed).
// Pure functions, unit-tested. English only for now.
//
// Two kinds of filled answers:
//   heard     - said outright ("I speak Dzongkha", "about 1,500 ngultrum")
//   suggested - clear from the meaning ("I don't have a business idea yet"
//               means the idea stage); listed in suggested_fields so the form
//               can label them for the person to check.

import type { Expertise, Language, Sector, Stage } from "../types";
import type { AssessmentDraft, DraftField } from "./schemas";
import { splitSentences } from "./transcripts";

export type { DraftField };

const SECTOR_RULES: Array<[Sector, RegExp]> = [
  ["tourism", /\b(homestays?|guest ?houses?|guests?|tours?|trek\w*|hotels?|travel\w*|tourism|tourists?|village walk|guided walk)\b/gi],
  ["agriculture", /\b(farm\w*|crops?|dairy|cheese|vegetables?|apples?|potato\w*|agri\w*|chillies|orchards?|poultry|cows?|cattle)\b/gi],
  ["handicrafts", /\b(weav\w*|crafts?|handicrafts?|textiles?|kira|gho|handmade|carv\w*|pottery)\b/gi],
  ["fintech", /\b(fintech|payments? app|digital payments?|wallets?|lending)\b/gi],
  ["technology", /\b(mobile app|app|software|website|platform|online marketplace)\b/gi],
  ["retail", /\b(my shop|our shop|store|retail|grocery|boutique)\b/gi],
];

/** Talking about this mentoring app itself ("I'm using this platform") is not their business. */
const SELF_REFERENCE = /\b(this|your) (platform|app|website|site|application)\b/gi;
const withoutSelfReference = (text: string) => text.replace(SELF_REFERENCE, " ");

/** Evidence in what was said for a given sector (after removing mentions of this app). */
export function sectorEvidence(sector: string, transcript: string): boolean {
  const rule = SECTOR_RULES.find(([s]) => s === sector);
  if (!rule) return false;
  return new RegExp(rule[1].source, "i").test(withoutSelfReference(transcript));
}

/** No business or idea yet: an aspiring entrepreneur. */
const ASPIRING =
  /\b(aspiring|no (business )?idea|don'?t have (a|my|any) (business )?idea|don'?t have a business|new to entrepreneurship|want to (start|become) (a|an|my) (business|entrepreneur)|get into entrepreneurship|haven'?t started)\b/i;

const STAGE_RULES: Array<[Stage, RegExp]> = [
  ["idea", /\b(an idea|my idea|planning to|plan to start|want to start|thinking of starting|haven'?t started|not started yet|aspiring|no (business )?idea|don'?t have (a|my|any) (business )?idea|new to entrepreneurship)\b/i],
  ["early", /\b(just started|started (last|this) year|recently started|first (customers|guests)|few (customers|guests)|new business|started \w+ months? ago)\b/i],
  ["growth", /\b(growing|expand\w*|scale up|hire more|more staff|second (branch|shop))\b/i],
  ["established", /\b(\d+|many|several|ten|five) years|established|for years\b/i],
];

const NEED_RULES: Array<[Expertise, RegExp]> = [
  ["idea_development", /\b(business idea|generate (an )?idea|find (an|a) idea|work on my ideas?|startup idea|get into entrepreneurship|new to entrepreneurship|aspiring)\b/i],
  ["customer_validation", /\b(who (my|our) (guests|customers) are|find(ing)? (more )?(customers|guests|buyers)|market research|what customers want)\b/i],
  ["market_positioning", /\b(how to describe|describe the|position\w*|stand out|how to market|marketing)\b/i],
  ["pricing", /\b(pric\w*|how much to charge|what to charge)\b/i],
  ["accounting", /\b(bookkeeping|accounting|keep(ing)? records|cash ?book)\b/i],
  ["financial_planning", /\b(cash flow|financial plan\w*|budgeting)\b/i],
  ["digital_payments", /\b(digital payments?|qr payments?|mobile payments?|pay by phone)\b/i],
  ["operations", /\b(operations|staff|schedul\w*|logistics)\b/i],
  ["branding", /\b(brand\w*|logo)\b/i],
  ["social_media", /\b(social media|facebook|instagram|tiktok)\b/i],
  ["regulatory_compliance", /\b(permits?|licen[cs]es?|regulations?|legal)\b/i],
  ["fundraising", /\b(funding|investors?|raise money|grants?)\b/i],
  ["product_development", /\b(build(ing)? the (app|product)|product development|prototype)\b/i],
];

/** Dzongkha as speech-to-text often spells it. */
const DZONGKHA = /\b(dzongkha|dzonkha|dzongka|zongkha|zonkha|zonka)\b/i;
const ENGLISH = /\benglish\b/i;
/** Ngultrum as speech-to-text often spells it. */
const CURRENCY = "(?:nu\\b\\.?|ngultrums?|ngultrim|ngultum|gultrim|gultrum)";

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** "one thousand five hundred" -> 1500, "fifteen hundred" -> 1500, "two thousand" -> 2000. */
export function wordsToNumber(text: string): number | null {
  const words = text.toLowerCase().replace(/-/g, " ").split(/\s+/).filter((w) => w && w !== "and");
  let total = 0;
  let current = 0;
  let seen = false;
  for (const w of words) {
    if (w in UNITS) {
      current += UNITS[w];
      seen = true;
    } else if (w === "hundred") {
      current = (current || 1) * 100;
      seen = true;
    } else if (w === "thousand") {
      total += (current || 1) * 1000;
      current = 0;
      seen = true;
    } else if (seen) {
      break;
    }
  }
  return seen ? total + current : null;
}

/** Budget per session in Nu., only if the person said an amount. */
export function parseBudget(text: string): number | null {
  const t = text.replace(/[‘’]/g, "'");
  const digits = t.match(new RegExp(`${CURRENCY}\\s*(\\d[\\d,]*)|(\\d[\\d,]*)\\s*${CURRENCY}`, "i"));
  if (digits) return Number((digits[1] ?? digits[2]).replace(/,/g, ""));
  const words = t.match(
    new RegExp(
      `((?:(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|and)[\\s-]+)+)${CURRENCY}`,
      "i",
    ),
  );
  if (words) return wordsToNumber(words[1]);
  const budget = t.match(/\b(?:budget|spend|afford|pay)\b[^.]{0,30}?(\d[\d,]*)/i);
  return budget ? Number(budget[1].replace(/,/g, "")) : null;
}

export function parseBusinessName(text: string): string | null {
  const m = text.match(/\b(?:I run|we run|it'?s called|called|named|my business is|our business is)\s+((?:[A-Z][\w'&-]*)(?:\s+(?:(?:[A-Z][\w'&-]*)|and|of|&))*)/);
  if (!m) return null;
  return m[1].replace(/\s+(and|of|&)$/i, "").trim() || null;
}

/** Drops greetings and "my name is X" so descriptions read as content, not small talk. */
export function cleanSentence(sentence: string): string {
  let s = sentence
    .replace(/^((hello|hi|hey|kuzu ?zangpo( la)?)[,.!]?\s*)+/i, "")
    .replace(/\b(so )?(currently )?my name is [A-Z][\w'-]*( [A-Z][\w'-]*)?\s*(and|,)?\s*/i, "")
    .replace(/^(so|okay|ok|and|well|um|uh)[,\s]+/i, "")
    .trim();
  if (s) s = s.charAt(0).toUpperCase() + s.slice(1);
  return s;
}

/** Draft from rules (no AI). Leaves anything not said or implied empty. */
export function ruleDraft(transcript: string): AssessmentDraft {
  const text = transcript.replace(/[‘’]/g, "'");
  const sentences = splitSentences(text);
  const suggested = new Set<DraftField>();
  const aspiring = ASPIRING.test(text);

  const sectorText = withoutSelfReference(text);
  const sectorScores = SECTOR_RULES.map(([sector, re]) => [sector, (sectorText.match(re) ?? []).length] as const).filter(([, n]) => n > 0);
  sectorScores.sort((a, b) => b[1] - a[1]);
  let sector: Sector | undefined = sectorScores[0]?.[0];
  if (!sector && aspiring) {
    sector = "undecided";
    suggested.add("sector");
  }

  const business_stage = STAGE_RULES.find(([, re]) => re.test(text))?.[0];
  if (business_stage === "idea" && aspiring) suggested.add("business_stage");

  const expertise_needs = NEED_RULES.filter(([, re]) => re.test(text)).map(([need]) => need).slice(0, 5);
  if (expertise_needs.includes("idea_development")) suggested.add("expertise_needs");

  const languages: Language[] = [];
  if (DZONGKHA.test(text)) languages.push("dz");
  if (ENGLISH.test(text)) languages.push("en");
  if (languages.length === 0) {
    // No language named: the person spoke English, so they speak it.
    languages.push("en");
    suggested.add("languages");
  }
  const preferredMatch = text.match(/\bprefer\w*\s+(\w+)\b/i);
  let preferred_language: Language | undefined;
  if (preferredMatch) {
    preferred_language = DZONGKHA.test(preferredMatch[1]) ? "dz" : ENGLISH.test(preferredMatch[1]) ? "en" : undefined;
  } else if (languages.length === 1 && !suggested.has("languages")) {
    preferred_language = languages[0];
  }

  let describing = sentences.filter((s) => /\b(we have|we offer|i run|we run|we sell|i sell|i make|we make|i grow|we grow|i have an idea)\b/i.test(s));
  if (describing.length === 0) {
    describing = sentences.filter((s) => /\b(i'm|i am) (an? )?(aspiring|new|student|farmer|weaver|entrepreneur)\b/i.test(s));
    if (describing.length) suggested.add("business_description");
  }

  let challenge = sentences.find((s) => /\b(challenge|problem|struggl\w*|difficult|hard to|don't (really )?know|not sure)\b/i.test(s));
  if (!challenge) {
    challenge = sentences.find((s) => /\b(want to (get|learn|know|understand|find)|how (i|to) can|no idea|don't have)\b/i.test(s));
    if (challenge) suggested.add("primary_challenge");
  }

  const goals = sentences.filter((s) => /\b(i want to|we want to|my goal|hope to|would like to)\b/i.test(s)).slice(0, 2);
  const budget = parseBudget(text) ?? undefined;
  const business_name = parseBusinessName(text) ?? undefined;

  return {
    business_name,
    business_stage,
    sector,
    business_description: describing.length ? describing.slice(0, 2).map(cleanSentence).filter(Boolean).join(" ").slice(0, 1000) || undefined : undefined,
    primary_challenge: challenge ? cleanSentence(challenge).slice(0, 1000) || undefined : undefined,
    goals: goals.map((g) => g.slice(0, 200)),
    expertise_needs,
    languages,
    preferred_language,
    budget,
    suggested_fields: [...suggested],
  };
}

/** Grounding for live AI: a name or budget must actually appear in what was said. */
export function groundDraft(draft: AssessmentDraft, transcript: string): AssessmentDraft {
  const out = { ...draft, suggested_fields: [...(draft.suggested_fields ?? [])] };
  if (out.business_name && !transcript.toLowerCase().includes(out.business_name.toLowerCase())) delete out.business_name;
  if (out.budget !== undefined) {
    const said = parseBudget(transcript);
    if (said === null || Math.abs(said - out.budget) > 0.5) {
      // Keep the AI's number only if that exact amount was spoken as digits.
      const digits = transcript.replace(/,/g, "").includes(String(out.budget));
      if (!digits) delete out.budget;
    }
  }
  const named = { dz: DZONGKHA.test(transcript), en: ENGLISH.test(transcript) };
  if (named.dz || named.en) {
    // Languages were named: keep only those.
    out.languages = (out.languages ?? []).filter((l) => named[l]);
    if (out.preferred_language && !named[out.preferred_language]) delete out.preferred_language;
  } else {
    // None named: the intro was spoken in English, so English (suggested) is all we know.
    out.languages = ["en"];
    if (!out.suggested_fields.includes("languages")) out.suggested_fields.push("languages");
    if (out.preferred_language === "dz") delete out.preferred_language;
  }
  // Exactly one language named and no stated preference: that language is the preference.
  const namedList = (["dz", "en"] as const).filter((l) => named[l]);
  if (!out.preferred_language && namedList.length === 1 && (out.languages ?? []).includes(namedList[0])) {
    out.preferred_language = namedList[0];
  }
  // The sector must be backed by what was said; otherwise it is only a suggestion
  // (or "not decided yet" for someone with no business).
  if (out.sector && out.sector !== "undecided" && !sectorEvidence(out.sector, transcript)) {
    if (ASPIRING.test(transcript)) out.sector = "undecided";
    if (!out.suggested_fields.includes("sector")) out.suggested_fields.push("sector");
  }
  // Said outright, so "Heard" even if the AI marked it as a suggestion. What was
  // only inferred (the stage, the kinds of help) keeps the AI's "Suggested".
  const heard = new Set<DraftField>();
  if (out.business_name) heard.add("business_name"); // kept above only if said
  if (out.budget !== undefined) heard.add("budget"); // kept above only if said
  if (named.dz || named.en) heard.add("languages");
  if (out.preferred_language && (PREFERS.test(transcript) || namedList.length === 1)) heard.add("preferred_language");
  if (out.sector && out.sector !== "undecided" && sectorEvidence(out.sector, transcript)) heard.add("sector");
  if (out.business_description && saidShare(out.business_description, transcript) >= 0.6) heard.add("business_description");
  if (out.primary_challenge && saidShare(out.primary_challenge, transcript) >= 0.6) heard.add("primary_challenge");
  out.suggested_fields = out.suggested_fields.filter((f) => {
    const v = out[f];
    return !heard.has(f) && !(v === undefined || v === "" || (Array.isArray(v) && v.length === 0));
  });
  return out;
}

const PREFERS = /\b(prefer|most comfortable|rather|would like)\b.{0,40}\b(dzongkha|dzonkha|dzongka|zongkha|zonkha|zonka|english)\b/i;

/** Share of a summary's meaningful words that the person actually said (0 to 1). */
export function saidShare(text: string, transcript: string): number {
  const words = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4);
  const spoken = new Set(words(transcript));
  const own = [...new Set(words(text))];
  if (own.length === 0) return 0;
  return own.filter((w) => spoken.has(w)).length / own.length;
}

/**
 * Answers needed before matching. The business name is optional: aspiring
 * entrepreneurs may not have one yet.
 */
export const QUESTION_FIELDS = [
  "sector",
  "business_stage",
  "business_description",
  "primary_challenge",
  "expertise_needs",
  "languages",
  "preferred_language",
  "budget",
] as const satisfies readonly DraftField[];

/** Fields still unanswered (the agent asks follow-up questions for these). */
export function missingFields(draft: AssessmentDraft): DraftField[] {
  return QUESTION_FIELDS.filter((f) => {
    const v = draft[f];
    return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
  });
}
