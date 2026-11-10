import "server-only";
import { providerPost } from "../agent/llm";

// Speech-to-text with Whisper on Groq (OpenAI-compatible).
// OWNER: the audio-to-text teammate.
//
// Limits on the Groq free tier: 25 MB per file. Long call recordings will
// need to be split into parts and the texts joined (not built yet).

export const TRANSCRIBE_MODEL = process.env.AI_MODEL_TRANSCRIBE ?? "whisper-large-v3-turbo";

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
