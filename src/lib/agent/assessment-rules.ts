// Rule-based reading of a spoken self-introduction into a needs-assessment
// draft. The fallback when live AI is off or fails, and the grounding check for
// the live answer (a name or budget the person never said is removed).
// Pure functions, unit-tested. English only for now.

import type { Expertise, Language, Sector, Stage } from "../types";
import type { AssessmentDraft } from "./schemas";
import { splitSentences } from "./transcripts";

const SECTOR_RULES: Array<[Sector, RegExp]> = [
  ["tourism", /\b(homestays?|guest ?houses?|guests?|tours?|trek\w*|hotels?|travel\w*|tourism|tourists?|village walk|guided walk)\b/gi],
  ["agriculture", /\b(farm\w*|crops?|dairy|cheese|vegetables?|apples?|potato\w*|agri\w*|chillies|orchards?|poultry|cows?|cattle)\b/gi],
  ["handicrafts", /\b(weav\w*|crafts?|handicrafts?|textiles?|kira|gho|handmade|carv\w*|pottery)\b/gi],
  ["fintech", /\b(fintech|payments? app|digital payments?|wallets?|lending)\b/gi],
  ["technology", /\b(mobile app|app|software|website|platform|online marketplace)\b/gi],
  ["retail", /\b(my shop|our shop|store|retail|grocery|boutique)\b/gi],
];

const STAGE_RULES: Array<[Stage, RegExp]> = [
  ["idea", /\b(an idea|my idea|planning to|plan to start|want to start|thinking of starting|haven'?t started|not started yet)\b/i],
  ["early", /\b(just started|started (last|this) year|recently started|first (customers|guests)|few (customers|guests)|new business|started \w+ months? ago)\b/i],
  ["growth", /\b(growing|expand\w*|scale up|hire more|more staff|second (branch|shop))\b/i],
  ["established", /\b(\d+|many|several|ten|five) years|established|for years\b/i],
];

const NEED_RULES: Array<[Expertise, RegExp]> = [
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

/** Draft from rules (no AI). Leaves anything not said empty. */
export function ruleDraft(transcript: string): AssessmentDraft {
  const text = transcript.replace(/[‘’]/g, "'");
  const sentences = splitSentences(text);

  const sectorScores = SECTOR_RULES.map(([sector, re]) => [sector, (text.match(re) ?? []).length] as const).filter(([, n]) => n > 0);
  sectorScores.sort((a, b) => b[1] - a[1]);
  const sector = sectorScores[0]?.[0];

  const business_stage = STAGE_RULES.find(([, re]) => re.test(text))?.[0];
  const expertise_needs = NEED_RULES.filter(([, re]) => re.test(text)).map(([need]) => need).slice(0, 5);

  const languages: Language[] = [];
  if (DZONGKHA.test(text)) languages.push("dz");
  if (ENGLISH.test(text)) languages.push("en");
  const preferredMatch = text.match(/\bprefer\w*\s+(\w+)\b/i);
  const preferred_language: Language | undefined = preferredMatch
    ? DZONGKHA.test(preferredMatch[1])
      ? "dz"
      : ENGLISH.test(preferredMatch[1])
        ? "en"
        : undefined
    : languages.length === 1
      ? languages[0]
      : undefined;

  const describing = sentences.filter((s) => /\b(we have|we offer|i run|we run|we sell|i sell|i make|we make|i grow|we grow|i have an idea)\b/i.test(s));
  const challenge = sentences.find((s) => /\b(challenge|problem|struggl\w*|difficult|hard to|don't (really )?know|not sure)\b/i.test(s));
  const goals = sentences.filter((s) => /\b(i want to|we want to|my goal|hope to|would like to)\b/i.test(s)).slice(0, 2);
  const budget = parseBudget(text) ?? undefined;
  const business_name = parseBusinessName(text) ?? undefined;

  return {
    business_name,
    business_stage,
    sector,
    business_description: describing.length ? describing.slice(0, 2).join(" ").slice(0, 1000) : undefined,
    primary_challenge: challenge?.slice(0, 1000),
    goals: goals.map((g) => g.slice(0, 200)),
    expertise_needs,
    languages,
    preferred_language,
    budget,
  };
}

/** Grounding for live AI: a name or budget must actually appear in what was said. */
export function groundDraft(draft: AssessmentDraft, transcript: string): AssessmentDraft {
  const out = { ...draft };
  if (out.business_name && !transcript.toLowerCase().includes(out.business_name.toLowerCase())) delete out.business_name;
  if (out.budget !== undefined) {
    const said = parseBudget(transcript);
    if (said === null || Math.abs(said - out.budget) > 0.5) {
      // Keep the AI's number only if that exact amount was spoken as digits.
      const digits = transcript.replace(/,/g, "").includes(String(out.budget));
      if (!digits) delete out.budget;
    }
  }
  const spoken = { dz: DZONGKHA.test(transcript), en: ENGLISH.test(transcript) };
  out.languages = (out.languages ?? []).filter((l) => spoken[l]);
  if (out.preferred_language && !spoken[out.preferred_language]) delete out.preferred_language;
  return out;
}

export const REQUIRED_FIELDS = [
  "business_name",
  "sector",
  "business_stage",
  "business_description",
  "primary_challenge",
  "expertise_needs",
  "languages",
  "preferred_language",
  "budget",
] as const;
export type DraftField = (typeof REQUIRED_FIELDS)[number];

/** Fields the person did not mention (shown as "Not mentioned" in the form). */
export function missingFields(draft: AssessmentDraft): DraftField[] {
  return REQUIRED_FIELDS.filter((f) => {
    const v = draft[f];
    return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
  });
}
