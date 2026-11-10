import "server-only";
import { z } from "zod";
import { MODELS, structured } from "../agent/llm";

/** Roles used in mentoring call transcripts (handover to the agent). */
export const CALL_SPEAKERS = ["Mentor", "Entrepreneur"] as const;
export type CallSpeaker = (typeof CALL_SPEAKERS)[number];

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface LabeledLine {
  speaker: CallSpeaker;
  text: string;
  start?: number;
  end?: number;
}

const LabeledTranscriptSchema = z.object({
  lines: z
    .array(
      z.object({
        speaker: z.enum(CALL_SPEAKERS),
        text: z.string().trim().min(1).max(2000),
      }),
    )
    .min(1)
    .max(80),
});

/** Format labeled turns the way the agent expects to read them. */
export function formatLabeledTranscript(lines: LabeledLine[]): string {
  return lines
    .map((l) => `[${l.speaker}] ${l.text.trim()}`)
    .filter((line) => line.length > 10)
    .join("\n");
}

/**
 * Assign Mentor / Entrepreneur labels to an unlabeled Whisper transcript.
 * Groq Whisper has no diarization; this uses dialogue cues (advice vs business
 * context) so the agent can tell owners apart when extracting actions.
 */
export async function labelMentorAndEntrepreneur(
  transcript: string,
  signal: AbortSignal,
  segments?: TranscriptSegment[],
): Promise<string> {
  const plain = transcript.trim();
  if (!plain) return "";

  const parts = splitForLabeling(plain, segments);
  const labeled: LabeledLine[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const prior = labeled
      .slice(-4)
      .map((l) => `[${l.speaker}] ${l.text}`)
      .join("\n");
    const raw = await structured({
      task: "label_call_speakers",
      model: MODELS.light,
      maxTokens: 1600,
      schema: LabeledTranscriptSchema,
      signal,
      system:
        "You label speakers in a YDF mentoring call transcript. " +
        "There are exactly two roles: Mentor (adviser: asks questions, gives advice, offers to send/help) " +
        "and Entrepreneur (business owner: describes the business, challenges, and commits to owner tasks). " +
        "Rewrite the input as consecutive dialogue turns. Keep the speakers' words; do not invent content. " +
        "Merge short fragments from the same speaker. Prefer Mentor for advisory offers like \"I'll send you\"; " +
        "prefer Entrepreneur for business facts and \"I'll call the suppliers\" style owner commitments. " +
        "If unsure, keep alternating from the last clear speaker. Output only the lines array.",
      user:
        (prior ? `Recent labeled turns (for consistency):\n${prior}\n\n` : "") +
        (parts.length > 1 ? `This is part ${i + 1} of ${parts.length}.\n\n` : "") +
        `Unlabeled transcript:\n${part}`,
    });
    const parsed = LabeledTranscriptSchema.safeParse(raw);
    if (!parsed.success) continue;
    for (const line of parsed.data.lines) {
      labeled.push({ speaker: line.speaker, text: line.text });
    }
  }

  if (labeled.length === 0) {
    // Soft fallback so the mentor can still edit: treat whole text as one block.
    return `[Mentor] ${plain}`;
  }
  return formatLabeledTranscript(labeled);
}

const LABEL_CHUNK_CHARS = 4_500;

function splitForLabeling(text: string, segments?: TranscriptSegment[]): string[] {
  if (segments && segments.length > 0) {
    const chunks: string[] = [];
    let buf = "";
    for (const seg of segments) {
      const piece = seg.text.trim();
      if (!piece) continue;
      if (buf.length + piece.length + 1 > LABEL_CHUNK_CHARS && buf) {
        chunks.push(buf.trim());
        buf = "";
      }
      buf += `${piece} `;
    }
    if (buf.trim()) chunks.push(buf.trim());
    return chunks.length > 0 ? chunks : [text];
  }
  if (text.length <= LABEL_CHUNK_CHARS) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + LABEL_CHUNK_CHARS, text.length);
    if (end < text.length) {
      const slice = text.slice(start, end);
      const breakAt = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("? "), slice.lastIndexOf("! "));
      if (breakAt > LABEL_CHUNK_CHARS / 2) end = start + breakAt + 1;
    }
    chunks.push(text.slice(start, end).trim());
    start = end;
  }
  return chunks.filter(Boolean);
}
