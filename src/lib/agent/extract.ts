import "server-only";
import type { ResultSource } from "../types";
import { aiCooldownRemainingMs, aiStep } from "./ai";
import { fallbackExtraction } from "./fallbacks";
import { live } from "./live";
import { MODELS } from "./llm";
import { rejectGenderedText } from "./prompts";
import { ChunkNotesSchema, ExtractionSchema, SINGLE_PASS_MAX_CHARS, type ChunkNotes, type Extraction, type NotesSource } from "./schemas";
import { CHUNK_CHARS, MAX_CHUNKS, findAgreements, hasSpeakerLabels, parseDueInDays, splitIntoChunks } from "./transcripts";

// Session text -> SMART draft actions.
//
// Short text: one pass (as before).
// Long text (calls over about 20 to 25 minutes):
//   1. split into parts at sentence boundaries,
//   2. pull the agreements out of each part, alternating the two models so both
//      free-tier budgets are used (llm.ts paces calls to stay under them),
//   3. combine and run one final SMART extraction.
// Every step has a rule-based fallback, so a long call always produces drafts
// for the mentor to check.

export interface ExtractResult {
  extraction: Extraction;
  source: ResultSource;
  parts: number;
  liveParts: number;
  /** For long transcripts: the combined notes the final step read (for review and debugging). */
  condensed?: string;
}

const PART_TIMEOUT_MS = 90_000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Rule-based notes for one part (fallback). */
function ruleNotes(chunk: string, now: Date): ChunkNotes {
  return {
    agreements: findAgreements(chunk, now).map((a) => ({
      what: a.what,
      who: a.who,
      timeframe: a.due_in_days ? `${a.due_in_days} days` : undefined,
    })),
    context: [],
  };
}

type Agreement = ChunkNotes["agreements"][number];

/**
 * Who does it, decided by the speaker's words where possible (the AI's choice
 * is only the fallback): "I'll / I will" = the mentor offering, "you / your" =
 * a task for the business owner.
 */
export function fixOwner(a: Agreement): Agreement {
  if (/\b(i'll|i will|i am going to|i'm going to)\b/i.test(a.what)) return { ...a, who: "mentor" };
  if (/\b(you|your)\b/i.test(a.what)) return { ...a, who: "entrepreneur" };
  return { ...a, who: a.who === "unclear" ? "entrepreneur" : a.who };
}

/**
 * For a transcript with [Mentor] / [Entrepreneur] labels: the owner comes from
 * the labelled sentence the agreement was taken from. If none matches, the
 * AI's choice is kept (it saw the labels too).
 */
export function ownerFromLabelledText(text: string): (a: Agreement) => Agreement {
  const found = findAgreements(text);
  return (a) => {
    const words = contentWords(a.what);
    let best: (typeof found)[number] | null = null;
    let bestShared = 1;
    for (const f of found) {
      const shared = [...contentWords(`${f.what} ${f.sentence}`)].filter((w) => words.has(w)).length;
      if (shared > bestShared) {
        bestShared = shared;
        best = f;
      }
    }
    if (best && best.who !== "unclear") return { ...a, who: best.who };
    return { ...a, who: a.who === "unclear" ? "entrepreneur" : a.who };
  };
}

/** All agreements from all parts, duplicates merged. */
export function mergeAgreements(notes: ChunkNotes[]): Agreement[] {
  const seen = new Set<string>();
  return notes
    .flatMap((n) => n.agreements)
    .filter((a) => {
      const key = a.what.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const STOP = new Set(["the", "and", "for", "with", "your", "you", "that", "this", "them", "each", "from", "will", "send", "make", "into", "about", "within", "days", "week"]);
function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !STOP.has(w))
      .map((w) => w.replace(/(ing|es|s)$/, "")),
  );
}

/**
 * Grounding check for the final step: keep only actions that match an agreement
 * found in the transcript (2+ shared content words), and take the owner from
 * that agreement. The AI cannot add tasks or flip owners.
 */
export function groundActions(actions: Extraction["actions"], agreements: Agreement[]): Extraction["actions"] {
  const used = new Set<number>();
  const out: Extraction["actions"] = [];
  for (const action of actions) {
    const words = contentWords(`${action.title} ${action.description ?? ""}`);
    let best = -1;
    let bestShared = 0;
    agreements.forEach((ag, i) => {
      if (used.has(i)) return;
      const shared = [...contentWords(ag.what)].filter((w) => words.has(w)).length;
      if (shared > bestShared) {
        bestShared = shared;
        best = i;
      }
    });
    if (best >= 0 && bestShared >= 2) {
      used.add(best);
      out.push({ ...action, owner: agreements[best].who === "mentor" ? "mentor" : "entrepreneur" });
    }
  }
  return out;
}

/**
 * Short text: the AI writes the wording and the measure, but where the
 * rule-based reader found the same agreement in the source sentence
 * ("I'll send..." = mentor, "Dorji will..." = entrepreneur), its owner wins.
 */
export function ownersFromSource(actions: Extraction["actions"], sourceText: string): Extraction["actions"] {
  const found = findAgreements(sourceText);
  const used = new Set<number>();
  return actions.map((action) => {
    const words = contentWords(`${action.title} ${action.description ?? ""}`);
    let best = -1;
    let bestShared = 0;
    found.forEach((f, i) => {
      if (used.has(i)) return;
      const shared = [...contentWords(`${f.what} ${f.sentence}`)].filter((w) => words.has(w)).length;
      if (shared > bestShared) {
        bestShared = shared;
        best = i;
      }
    });
    if (best < 0 || bestShared < 2) return action;
    used.add(best);
    return { ...action, owner: found[best].who === "mentor" ? "mentor" : "entrepreneur" };
  });
}

/** Combined notes as text: the agreed actions, plus context for the reviewer. */
export function renderCondensed(notes: ChunkNotes[], parts: number, withContext = true): string {
  const agreements = mergeAgreements(notes);
  const context = [...new Set(notes.flatMap((n) => n.context))].slice(0, 12);
  return [
    `Condensed from a ${parts}-part call transcript.`,
    "Agreed actions:",
    ...(agreements.length ? agreements.map((a) => `- (${a.who}${a.timeframe ? `, ${a.timeframe}` : ""}) ${a.what}`) : ["- none found"]),
    ...(withContext ? ["Context (background only, not actions):", ...(context.length ? context.map((c) => `- ${c}`) : ["- none"])] : []),
  ].join("\n");
}

/** Rule-based final extraction straight from the combined notes (fallback). */
export function extractionFromNotes(notes: ChunkNotes[], parts: number, now?: Date): Extraction {
  const actions = mergeAgreements(notes)
    .slice(0, 8)
    .map((a) => ({
      title: a.what.length > 140 ? `${a.what.slice(0, 137)}...` : a.what,
      owner: a.who === "mentor" ? ("mentor" as const) : ("entrepreneur" as const),
      due_in_days: parseDueInDays(a.timeframe ?? "", now) ?? 7,
    }));
  return {
    summary:
      actions.length > 0
        ? `Found ${actions.length} agreed action${actions.length === 1 ? "" : "s"} in a ${parts}-part call transcript. Check them before confirming.`
        : "No clear agreed actions were found in the call.",
    actions,
  };
}

/**
 * `now` is "today" for deadlines said as day names ("by Friday"): pass the
 * demo clock, so fast-forwarding the demo moves today too.
 */
export async function extractFromText(text: string, source: NotesSource, now: Date = new Date()): Promise<ExtractResult> {
  // Short: one pass, as before.
  if (text.length <= SINGLE_PASS_MAX_CHARS + 4100) {
    const step = await aiStep({
      task: "extract_action_items",
      schema: ExtractionSchema,
      fallback: () => fallbackExtraction(text, now),
      live: live.extraction(text, source, false, now),
      validate: rejectGenderedText,
    });
    const extraction =
      step.source === "live_ai" ? { ...step.value, actions: ownersFromSource(step.value.actions, text) } : step.value;
    return { extraction, source: step.source, parts: 1, liveParts: step.source === "live_ai" ? 1 : 0 };
  }

  // Long: split, read each part, combine.
  const chunks = splitIntoChunks(text, CHUNK_CHARS).slice(0, MAX_CHUNKS);
  const notes: ChunkNotes[] = [];
  let liveParts = 0;
  for (let i = 0; i < chunks.length; i++) {
    const model = i % 2 === 0 ? MODELS.light : MODELS.main;
    const run = () =>
      aiStep({
        task: "condense_transcript_part",
        schema: ChunkNotesSchema,
        fallback: () => ruleNotes(chunks[i], now),
        live: live.condenseChunk(chunks[i], i + 1, chunks.length, model),
        // Intermediate notes are never shown to users, so no pronoun check here;
        // the final extraction below is still checked.
        timeoutMs: PART_TIMEOUT_MS,
      });
    let step = await run();
    if (step.fallbackReason === "rate_limited") {
      // Background work can afford to wait out the pause once.
      await sleep(Math.min(aiCooldownRemainingMs() + 500, 61_000));
      step = await run();
    }
    if (step.source === "live_ai") {
      liveParts += 1;
      // Owners in AI notes are decided by the speaker's words, not the AI's guess.
      // (The rule-based reader already decided them from the full sentence.)
      // With speaker labels, the labelled line decides (see ownerFromSpeaker).
      const owner = hasSpeakerLabels(chunks[i]) ? ownerFromLabelledText(chunks[i]) : fixOwner;
      notes.push({ ...step.value, agreements: step.value.agreements.map(owner) });
    } else {
      notes.push(step.value);
    }
  }

  // The final step sees only the agreed actions (context lines would tempt it
  // to invent tasks); its output is then grounded against those agreements.
  const condensed = renderCondensed(notes, chunks.length);
  const agreements = mergeAgreements(notes);
  const final = await aiStep({
    task: "extract_action_items",
    schema: ExtractionSchema,
    fallback: () => extractionFromNotes(notes, chunks.length, now),
    live: live.extraction(renderCondensed(notes, chunks.length, false), source, true, now),
    validate: rejectGenderedText,
    timeoutMs: PART_TIMEOUT_MS,
  });
  let extraction = final.value;
  if (final.source === "live_ai") {
    const grounded = groundActions(extraction.actions, agreements);
    extraction = grounded.length > 0 || agreements.length === 0 ? { ...extraction, actions: grounded } : extractionFromNotes(notes, chunks.length, now);
  }
  // Labelled by what wrote the drafts the mentor sees; the run text says how many parts were read live.
  return { extraction, source: final.source, parts: chunks.length, liveParts, condensed };
}
