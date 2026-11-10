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

/** Languages we ask Whisper for explicitly (English first; others later). */
export const TRANSCRIBE_LANGUAGES = ["en"] as const;
export type TranscribeLanguage = (typeof TRANSCRIBE_LANGUAGES)[number];

/**
 * Spelling hint for Whisper: local words it otherwise mishears
 * (for example "Dzongkha" as "Zonka", "ngultrum" as "Gultrim").
 */
export const VOCABULARY_HINT =
  "Bhutan. Dzongkha and English. Ngultrum (Nu.). Thimphu, Paro, Punakha, Bumthang, Wangdue, Trashigang. " +
  "Homestay, gewog, dzongkhag, YDF, mentor, mentoring session.";

export async function transcribe(file: Blob, filename: string, signal: AbortSignal, language?: TranscribeLanguage): Promise<string> {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("model", TRANSCRIBE_MODEL);
  form.append("response_format", "json");
  // Telling Whisper the language is faster and more accurate than auto-detect.
  if (language) form.append("language", language);
  form.append("prompt", VOCABULARY_HINT);
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
    .map((s) => ({ text: String((s as { text?: unknown }).text ?? "").trim() }))
    .filter((s) => s.text.length > 0);
  return { text, segments };
}

export interface CallTranscription {
  /** [Mentor] / [Entrepreneur] turns when labelled, otherwise the plain transcript. */
  text: string;
  /** Whisper's text before any labels. */
  raw_text: string;
  /** false when the speaker guess could not finish safely (the plain transcript is returned). */
  labeled: boolean;
}

/**
 * Transcribe a mentoring call recording (audio or video) and, if it can be
 * done safely before `deadline` (epoch ms), label the two speakers as Mentor
 * and Entrepreneur. A labelling failure never loses the transcript.
 */
export async function transcribeCallRecording(
  file: Blob,
  filename: string,
  signal: AbortSignal,
  deadline: number,
): Promise<CallTranscription> {
  const { text, segments } = await transcribeVerbose(file, filename, signal);
  if (!text) return { text: "", raw_text: "", labeled: false };
  try {
    const labeled = await labelMentorAndEntrepreneur(text, segments, deadline);
    return { text: labeled.text || text, raw_text: text, labeled: labeled.labeled };
  } catch (err) {
    console.warn("[ai] label_call_speakers failed; returning the plain transcript:", err instanceof Error ? err.message.slice(0, 200) : "error");
    return { text, raw_text: text, labeled: false };
  }
}
