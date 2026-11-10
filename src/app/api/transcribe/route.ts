import { aiMode } from "@/lib/agent/ai";
import { ProviderError, RateLimitError, apiKey } from "@/lib/agent/llm";
import { transcribe, transcribeCallRecording } from "@/lib/audio/transcribe";
import { fail, ok } from "@/lib/http";

// POST /api/transcribe (multipart, field "file"):
//   - voice_note (default): mentor dictation -> plain text
//   - call_recording: audio/video -> [Mentor]/[Entrepreneur] transcript
// See ONBOARDING.md section 9 (Area 1: Audio).

const MAX_BYTES = 25 * 1024 * 1024; // Groq free-tier upload limit
const VOICE_TIMEOUT_MS = 30_000;
const CALL_TIMEOUT_MS = 120_000;

const AUDIO_OR_VIDEO =
  /\.(flac|mp3|mp4|mpeg|mpga|m4a|ogg|wav|webm)$/i;

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

  const modeRaw = String(form.get("mode") ?? "voice_note").trim();
  const mode = modeRaw === "call_recording" ? "call_recording" : "voice_note";
  const filename = file.name || (mode === "call_recording" ? "call-recording.webm" : "voice-note.webm");
  if (
    mode === "call_recording" &&
    !AUDIO_OR_VIDEO.test(filename) &&
    !file.type.startsWith("audio/") &&
    !file.type.startsWith("video/")
  ) {
    return fail(400, "INVALID_INPUT", "Upload an audio or video file (mp3, wav, mp4, webm, …).");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), mode === "call_recording" ? CALL_TIMEOUT_MS : VOICE_TIMEOUT_MS);
  try {
    if (mode === "call_recording") {
      const { text, raw_text } = await transcribeCallRecording(file, filename, controller.signal);
      if (!text) return fail(422, "EMPTY_TRANSCRIPT", "No speech was recognised. Try again, or type the notes.");
      return ok({ text, raw_text, mode, speakers: ["Mentor", "Entrepreneur"] as const });
    }
    const text = await transcribe(file, filename, controller.signal);
    if (!text) return fail(422, "EMPTY_TRANSCRIPT", "No speech was recognised. Try again, or type the notes.");
    return ok({ text, mode });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return fail(429, "RATE_LIMITED", "The transcription service is busy. Wait a minute, or type the notes.");
    }
    const detail = err instanceof Error ? err.message.slice(0, 200) : "error";
    console.warn("[ai] transcribe failed:", detail);
    if (err instanceof Error && /aborted/i.test(err.message)) {
      return fail(504, "TRANSCRIPTION_TIMEOUT", "Transcription timed out. Try a shorter clip.");
    }
    const hint = err instanceof ProviderError ? detail.replace(/^\d+:\s*/, "") : "";
    return fail(
      502,
      "TRANSCRIPTION_FAILED",
      hint ? `Could not transcribe the audio (${hint}).` : "Could not transcribe the audio. Type the notes instead.",
    );
  } finally {
    clearTimeout(timer);
  }
}
