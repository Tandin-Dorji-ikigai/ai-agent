import "server-only";
import { z } from "zod";
import { aiStep } from "../agent/ai";
import { BACKGROUND_MAX_WAIT_MS, MODELS, structured } from "../agent/llm";

// Speaker labels for a mentoring call transcript (handover to the agent).
// Groq Whisper cannot tell voices apart, so this is a GUESS from the words.
// Safety rules:
//   - the AI only returns a label per numbered line; it never rewrites words,
//     so nothing can be invented or dropped;
//   - labels are all or nothing: if any part fails (error, rate limit, bad
//     output, running out of time), the plain transcript is returned instead,
//     and the agent infers owners from the words as before.
// When calls record each person's microphone separately, speakers will be
// known for certain and this guess is no longer needed.

/** Roles used in mentoring call transcripts. */
export const CALL_SPEAKERS = ["Mentor", "Entrepreneur"] as const;
export type CallSpeaker = (typeof CALL_SPEAKERS)[number];

/** One piece of Whisper output (verbose_json segment). */
export interface TranscriptSegment {
  text: string;
}

export interface LabelResult {
  /** "[Mentor] ...\n[Entrepreneur] ..." when labelled, else the plain transcript. */
  text: string;
  labeled: boolean;
}

/** Most lines and characters sent in one AI call (labels-only output stays small). */
const PART_LINES = 120;
const PART_CHARS = 12_000;
/** Stop labelling with this much time left, so the transcript always comes back. */
const SAFETY_MS = 8_000;

const LabelsSchema = z.object({ speakers: z.array(z.enum(CALL_SPEAKERS)) });

/** Whisper segments (or the text) split into sentences: the units that get a label. */
export function transcriptLines(text: string, segments?: TranscriptSegment[]): string[] {
  const pieces = segments && segments.length > 0 ? segments.map((s) => s.text) : [text];
  return pieces
    .flatMap((p) => p.split(/(?<=[.?!])\s+/))
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Groups lines into parts small enough for one AI call. */
export function partitionLines(lines: string[], maxLines = PART_LINES, maxChars = PART_CHARS): string[][] {
  const parts: string[][] = [];
  let current: string[] = [];
  let chars = 0;
  for (const line of lines) {
    if (current.length > 0 && (current.length >= maxLines || chars + line.length > maxChars)) {
      parts.push(current);
      current = [];
      chars = 0;
    }
    current.push(line);
    chars += line.length + 1;
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

/** Joins labelled lines into turns, merging consecutive lines from the same speaker. */
export function formatLabeled(lines: string[], speakers: CallSpeaker[]): string {
  const turns: Array<{ speaker: CallSpeaker; text: string }> = [];
  lines.forEach((line, i) => {
    const speaker = speakers[i];
    const last = turns.at(-1);
    if (last && last.speaker === speaker) last.text += ` ${line}`;
    else turns.push({ speaker, text: line });
  });
  return turns.map((t) => `[${t.speaker}] ${t.text}`).join("\n");
}

const SYSTEM =
  "You label speakers in a YDF mentoring call transcript between exactly two people. " +
  "Mentor: the adviser (asks questions, gives advice, offers to send or introduce something, e.g. \"I'll send you\"). " +
  "Entrepreneur: the business owner (describes the business and challenges, agrees to do owner tasks, e.g. \"I'll call the suppliers\"). " +
  "You get numbered lines in order. Return speakers: exactly one label per line, in the same order. " +
  "Speakers usually alternate in turns; a reply like \"Okay, I will...\" follows the other person. Do not output any text from the lines.";

/**
 * Labels a call transcript as Mentor / Entrepreneur turns, or returns it
 * unlabelled if labelling cannot finish safely before `deadline` (epoch ms).
 */
export async function labelMentorAndEntrepreneur(transcript: string, segments: TranscriptSegment[] | undefined, deadline: number): Promise<LabelResult> {
  const plain = transcript.trim();
  const unlabeled = { text: plain, labeled: false };
  const lines = transcriptLines(plain, segments);
  if (lines.length < 2) return unlabeled;

  const speakers: CallSpeaker[] = [];
  const parts = partitionLines(lines);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const timeLeft = deadline - Date.now() - SAFETY_MS;
    if (timeLeft <= 0) return unlabeled;
    const before = speakers.length > 0 ? `The line just before this part was said by the ${speakers.at(-1)}.\n` : "";
    const step = await aiStep({
      task: "label_call_speakers",
      schema: LabelsSchema,
      fallback: () => ({ speakers: [] }),
      timeoutMs: timeLeft,
      validate: (v) => (v.speakers.length === part.length ? null : `expected ${part.length} labels, got ${v.speakers.length}`),
      live: (signal) =>
        structured({
          task: "label_call_speakers",
          model: MODELS.light,
          maxTokens: 600 + part.length * 8,
          maxWaitMs: Math.min(BACKGROUND_MAX_WAIT_MS, timeLeft),
          schema: LabelsSchema,
          signal,
          system: SYSTEM,
          user:
            before +
            (parts.length > 1 ? `Part ${i + 1} of ${parts.length}. ` : "") +
            `${part.length} lines:\n` +
            part.map((l, n) => `${n + 1}. ${l}`).join("\n"),
        }),
    });
    if (step.source !== "live_ai") return unlabeled;
    speakers.push(...step.value.speakers);
  }
  return { text: formatLabeled(lines, speakers), labeled: true };
}
