import { aiMode } from "@/lib/agent/ai";
import { RateLimitError, apiKey, transcribe } from "@/lib/agent/llm";
import { fail, ok } from "@/lib/http";

// POST /api/transcribe (multipart, field "file"): a mentor's voice note -> text
// (team workflow, Area 1: "Audio (Whisper API)"). The text then goes through
// the same extraction step as typed notes, and the mentor reviews it first.

const MAX_BYTES = 25 * 1024 * 1024; // Groq free-tier upload limit

export async function POST(req: Request) {
  if (aiMode() !== "live" || !apiKey()) {
    return fail(503, "TRANSCRIPTION_UNAVAILABLE", "Voice notes need live AI. Type the notes instead.");
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "INVALID_INPUT", "Send the audio as form data.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "INVALID_INPUT", "No audio file received.");
  if (file.size === 0 || file.size > MAX_BYTES) return fail(400, "INVALID_INPUT", "The audio must be under 25 MB.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const text = await transcribe(file, file.name || "voice-note.webm", controller.signal);
    if (!text) return fail(422, "EMPTY_TRANSCRIPT", "No speech was recognised. Try again, or type the notes.");
    return ok({ text });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return fail(429, "RATE_LIMITED", "The transcription service is busy. Wait a minute, or type the notes.");
    }
    console.warn("[ai] transcribe failed:", err instanceof Error ? err.message.slice(0, 200) : "error");
    return fail(502, "TRANSCRIPTION_FAILED", "Could not transcribe the audio. Type the notes instead.");
  } finally {
    clearTimeout(timer);
  }
}
