// Long call transcripts: pure helpers (no AI, no database), unit-tested.
//
// A one-hour call is too big for one request on the Groq free tier
// (8,000 tokens a minute per model), so the agent:
//   1. splits the transcript into parts at sentence boundaries,
//   2. pulls the agreements out of each part (live AI, or the rules below),
//   3. combines them and runs the usual SMART extraction.
//
// The rule-based extractor here is the fallback when AI is off, slow or
// rate-limited. It is extractive: it only keeps sentences where people
// agreed on something, so it never invents actions.

import type { Extraction } from "./schemas";

/** About 1,500 tokens per part: leaves room for the prompt and the answer. */
export const CHUNK_CHARS = 6_000;
/** Safety cap: 40 parts is roughly four hours of speech. */
export const MAX_CHUNKS = 40;

export function normaliseSpace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function splitSentences(text: string): string[] {
  return normaliseSpace(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Splits at sentence boundaries; a single over-long sentence is split by words. */
export function splitIntoChunks(text: string, maxChars = CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let current = "";
  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const sentence of splitSentences(text)) {
    if (sentence.length > maxChars) {
      push();
      let piece = "";
      for (const word of sentence.split(" ")) {
        if (piece.length + word.length + 1 > maxChars) {
          chunks.push(piece.trim());
          piece = "";
        }
        piece += `${word} `;
      }
      current = piece;
      continue;
    }
    if (current.length + sentence.length + 1 > maxChars) push();
    current += `${sentence} `;
  }
  push();
  return chunks;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Timeframes ("within four days", "next week", "no wait, make that two weeks")
// ---------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30, a: 1, an: 1,
};

function toNumber(word: string): number | null {
  const n = Number(word);
  if (Number.isFinite(n)) return n;
  return NUMBER_WORDS[word.toLowerCase()] ?? null;
}

const UNIT_DAYS: Record<string, number> = { day: 1, days: 1, week: 7, weeks: 7, month: 30, months: 30 };

/** Days until due, from the LAST timeframe mentioned (so corrections win). */
export function parseDueInDays(text: string): number | null {
  const found: number[] = [];
  const re = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|a|an)\s+(days?|weeks?|months?)\b/gi;
  for (const m of text.matchAll(re)) {
    const n = toNumber(m[1]);
    if (n !== null) found.push(n * UNIT_DAYS[m[2].toLowerCase()]);
  }
  const last = found.at(-1);
  if (last !== undefined) return Math.min(60, Math.max(1, last));
  if (/\btomorrow\b/i.test(text)) return 1;
  if (/\b(next week|this week|end of the week|by friday|by monday)\b/i.test(text)) return 7;
  if (/\bnext month\b/i.test(text)) return 30;
  return null;
}

// ---------------------------------------------------------------------------
// Rule-based agreement finder (fallback when live AI is unavailable)
// ---------------------------------------------------------------------------

const AGREEMENT = /\b(we agree(?:d)?|agreed|you will|you'll|i will|i'll|let's|next step|action|by (?:next|tomorrow|friday|monday)|within)\b/i;
const REJECTED =
  /\b(decided not|not now|let's not|won't|will not|don't need to|no need to|maybe later|not this season|nothing (?:was )?agreed|no agreement|didn't agree|did not agree|nothing to do)\b/i;
const MENTOR_OFFER = /\b(i'll|i will) (send|introduce|connect|share|email|call|check with|ask)\b/i;
const LEAD_IN = /^(so|okay|ok|and|also|then|right|great|um|uh|well)[,\s]+/i;

function cleanTitle(sentence: string): string {
  let t = sentence
    .replace(/^(so |okay,? |ok,? )?(the )?(first|second|third|next|last|final) (thing|agreement|step)( we agree(d)?( on)?)?[.:,]?\s*/i, "")
    .replace(/\b(so )?we agree(d)? (on )?(three|two|four|a few|these)? ?things?[.:,]?\s*/i, "")
    .replace(/^(and )?(finally,? )?let's agree( that)?\s*/i, "")
    .replace(/\b(within|in) (\d+|[a-z]+) (days?|weeks?|months?)[,]?\s*/i, "")
    .replace(/\b(by (next week|tomorrow|friday|monday))[,]?\s*/i, "")
    .replace(/\b(you will|you'll|we will|we'll|i will|i'll|let's)\s+/i, "")
    .replace(/\b(no wait|sorry|um|uh)[,]?\s*/gi, "")
    .replace(/[.!?]+$/, "")
    .trim();
  for (let i = 0; i < 3; i++) t = t.replace(LEAD_IN, "").trim();
  if (!t) return "";
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return t.length > 140 ? `${t.slice(0, 137).trimEnd()}...` : t;
}

export interface FoundAgreement {
  what: string;
  /** The sentence it came from (shown to the mentor as context). */
  sentence: string;
  who: "entrepreneur" | "mentor" | "unclear";
  due_in_days: number | null;
}

const SPEAKER_LABEL = /^\[(Mentor|Entrepreneur)\]\s*/;
const FIRST_PERSON = /\b(i'll|i will|i am going to|i'm going to|let me)\b/i;
const SECOND_PERSON = /\b(you|your|you'll)\b/i;

type Speaker = "mentor" | "entrepreneur";

/** true when the text has [Mentor] / [Entrepreneur] turns (for example from a call recorded per person). */
export function hasSpeakerLabels(text: string): boolean {
  return /^\[(Mentor|Entrepreneur)\]\s/m.test(text);
}

/**
 * Who does it, when the speaker is KNOWN: a speaker's own "I will..." is
 * their task; "you..." is the other person's; anything else (an instruction
 * or a summary like "within four days, check the permits") is the entrepreneur's.
 */
export function ownerFromSpeaker(sentence: string, speaker: Speaker): Speaker {
  if (FIRST_PERSON.test(sentence)) return speaker;
  if (SECOND_PERSON.test(sentence)) return speaker === "mentor" ? "entrepreneur" : "mentor";
  return "entrepreneur";
}

/** Sentences with their speaker (null when the text, or that line, has no speaker label). */
function sentencesWithSpeakers(text: string): Array<{ sentence: string; speaker: Speaker | null }> {
  if (!hasSpeakerLabels(text)) return splitSentences(text).map((sentence) => ({ sentence, speaker: null }));
  return text.split(/\n+/).flatMap((line) => {
    const m = SPEAKER_LABEL.exec(line.trim());
    const speaker: Speaker | null = m ? (m[1] === "Mentor" ? "mentor" : "entrepreneur") : null;
    return splitSentences(m ? line.trim().slice(m[0].length) : line).map((sentence) => ({ sentence, speaker }));
  });
}

export function findAgreements(text: string): FoundAgreement[] {
  const out: FoundAgreement[] = [];
  const seen = new Set<string>();
  for (const { sentence: s, speaker } of sentencesWithSpeakers(text.replace(/[‘’]/g, "'"))) {
    if (!AGREEMENT.test(s) || REJECTED.test(s) || s.endsWith("?")) continue;
    const what = cleanTitle(s);
    if (what.length < 8) continue;
    const key = what.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    const who = speaker ? ownerFromSpeaker(s, speaker) : MENTOR_OFFER.test(s) ? "mentor" : "entrepreneur";
    out.push({ what, sentence: s.slice(0, 300), who, due_in_days: parseDueInDays(s) });
  }
  return out.slice(0, 8);
}

/** Rule-based extraction from any text (no AI). */
export function heuristicExtraction(text: string, parts = 1): Extraction {
  const agreements = findAgreements(text);
  return {
    summary:
      agreements.length > 0
        ? `Found ${agreements.length} agreed action${agreements.length === 1 ? "" : "s"} in ${parts > 1 ? `a ${parts}-part call transcript` : "the session text"} (rule-based reading; check before confirming).`
        : "No clear agreed actions were found. Add them by hand if the session agreed any.",
    actions: agreements.map((a) => ({
      title: a.what,
      description: a.sentence,
      owner: a.who === "mentor" ? ("mentor" as const) : ("entrepreneur" as const),
      due_in_days: a.due_in_days ?? 7,
    })),
  };
}
