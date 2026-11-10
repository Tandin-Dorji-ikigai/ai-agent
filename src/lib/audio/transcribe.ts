import "server-only";
import { providerPost } from "../agent/llm";
import { labelMentorAndEntrepreneur, type TranscriptSegment } from "./speakers";

// Speech-to-text with Whisper on Groq (OpenAI-compatible).
// OWNER: the audio-to-text teammate.
//
// Limits on the Groq free tier: 25 MB per file. Long call recordings will
// need to be split into parts and the texts joined (not built yet).
// Audio and video containers Groq accepts: flac, mp3, mp4, mpeg, mpga, m4a,
// ogg, wav, webm (video files use the first audio track).

export const TRANSCRIBE_MODEL = process.env.AI_MODEL_TRANSCRIBE ?? "whisper-large-v3-turbo";

const CALL_PROMPT =
  "A mentoring call between a Mentor and an Entrepreneur in Bhutan. " +
  "Use clear punctuation. Prefer spellings: YDF, Dzongkha, Thimphu, Paro.";

export async function transcribe(file: Blob, filename: string, signal: AbortSignal): Promise<string> {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("model", TRANSCRIBE_MODEL);
  form.append("response_format", "json");
  const data = await providerPost("/audio/transcriptions", form, signal, false);
  console.info(`[ai] transcribe via ${TRANSCRIBE_MODEL}: ${Math.round(file.size / 1024)} KB`);
  return String(data.text ?? "").trim();
}

interface VerboseTranscription {
  text: string;
  segments: TranscriptSegment[];
}

async function transcribeVerbose(file: Blob, filename: string, signal: AbortSignal): Promise<VerboseTranscription> {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("model", TRANSCRIBE_MODEL);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  form.append("prompt", CALL_PROMPT);
  const data = await providerPost("/audio/transcriptions", form, signal, false);
  console.info(`[ai] transcribe(verbose) via ${TRANSCRIBE_MODEL}: ${Math.round(file.size / 1024)} KB`);
  const text = String(data.text ?? "").trim();
  const raw = Array.isArray(data.segments) ? data.segments : [];
  const segments: TranscriptSegment[] = raw
    .map((s) => {
      const row = s as { start?: unknown; end?: unknown; text?: unknown };
      return {
        start: Number(row.start) || 0,
        end: Number(row.end) || 0,
        text: String(row.text ?? "").trim(),
      };
    })
    .filter((s) => s.text.length > 0);
  return { text, segments };
}

export interface CallTranscription {
  /** Labeled dialogue: [Mentor] / [Entrepreneur] lines. */
  text: string;
  /** Raw Whisper text before speaker labeling. */
  raw_text: string;
}

/**
 * Transcribe a mentoring call recording (audio or video) and label the two
 * speakers as Mentor and Entrepreneur for the session handover contract.
 */
export async function transcribeCallRecording(
  file: Blob,
  filename: string,
  signal: AbortSignal,
): Promise<CallTranscription> {
  const { text, segments } = await transcribeVerbose(file, filename, signal);
  if (!text) return { text: "", raw_text: "" };
  const labeled = await labelMentorAndEntrepreneur(text, signal, segments);
  return { text: labeled || text, raw_text: text };
}
