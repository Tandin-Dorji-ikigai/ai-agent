import "server-only";
import { providerPost } from "../agent/llm";

// Speech-to-text with Whisper on Groq (OpenAI-compatible).
// OWNER: the audio-to-text teammate.
//
// Limits on the Groq free tier: 25 MB per file. Long call recordings will
// need to be split into parts and the texts joined (not built yet).

export const TRANSCRIBE_MODEL = process.env.AI_MODEL_TRANSCRIBE ?? "whisper-large-v3-turbo";

export async function transcribe(file: Blob, filename: string, signal: AbortSignal): Promise<string> {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("model", TRANSCRIBE_MODEL);
  form.append("response_format", "json");
  const data = await providerPost("/audio/transcriptions", form, signal, false);
  console.info(`[ai] transcribe via ${TRANSCRIBE_MODEL}: ${Math.round(file.size / 1024)} KB`);
  return String(data.text ?? "").trim();
}
