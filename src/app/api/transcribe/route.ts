import { aiMode } from "@/lib/agent/ai";
import { ProviderError, RateLimitError, apiKey } from "@/lib/agent/llm";
import { CALL_SPEAKERS } from "@/lib/audio/speakers";
import { TRANSCRIBE_LANGUAGES, transcribe, transcribeCallRecording, type TranscribeLanguage } from "@/lib/audio/transcribe";
import { fail, ok } from "@/lib/http";

// POST /api/transcribe (multipart, field "file"):
//   - voice_note (default): mentor dictation or the entrepreneur's voice intro -> plain text
//     (optional field "language": only "en" for now, Dzongkha and others later)
//   - call_recording: audio/video -> [Mentor]/[Entrepreneur] transcript when the
//     speaker guess finishes safely ("labeled": true), otherwise the plain transcript
// See ONBOARDING.md section 9 (Area 1: Audio).

const MAX_BYTES = 25 * 1024 * 1024; // Groq free-tier upload limit
const VOICE_TIMEOUT_MS = 30_000;
const CALL_TIMEOUT_MS = 120_000;

// What Groq Whisper accepts. Anything else (for example iPhone .mov, .mkv, .aac)
// is refused here, before a long upload fails at Groq.
const ACCEPTED_EXTENSIONS = /\.(flac|mp3|mp4|mpeg|mpga|m4a|ogg|wav|webm)$/i;
const ACCEPTED_TYPES = new Set([
  "audio/flac",
  "audio/x-flac",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/webm",
  "video/mp4",
  "video/mpeg",
  "video/webm",
]);

function isAcceptedFormat(file: File, filename: string): boolean {
  return ACCEPTED_EXTENSIONS.test(filename) || ACCEPTED_TYPES.has(file.type.split(";")[0].trim().toLowerCase());
}

/** The HTTP status Groq returned, if any (ProviderError messages start with it). */
function providerStatus(err: unknown): number | null {
  const m = err instanceof ProviderError ? /^(\d{3}):/.exec(err.message) : null;
  return m ? Number(m[1]) : null;
}

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

  const lang = form.get("language");
  const language = (TRANSCRIBE_LANGUAGES as readonly string[]).includes(String(lang)) ? (lang as TranscribeLanguage) : undefined;

  const modeRaw = String(form.get("mode") ?? "voice_note").trim();
  const mode = modeRaw === "call_recording" ? "call_recording" : "voice_note";
  const filename = file.name || (mode === "call_recording" ? "call-recording.webm" : "voice-note.webm");
  if (!isAcceptedFormat(file, filename)) {
    return fail(400, "UNSUPPORTED_FORMAT", "Use an mp3, m4a, wav, ogg, flac, webm or mp4 file. Other formats (such as .mov) are not accepted.");
  }

  const timeoutMs = mode === "call_recording" ? CALL_TIMEOUT_MS : VOICE_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (mode === "call_recording") {
      const { text, raw_text, labeled } = await transcribeCallRecording(file, filename, controller.signal, deadline);
      if (!text) return fail(422, "EMPTY_TRANSCRIPT", "No speech was recognised. Try again, or type the notes.");
      return ok({ text, raw_text, mode, labeled, speakers: labeled ? CALL_SPEAKERS : [] });
    }
    const text = await transcribe(file, filename, controller.signal, language);
    if (!text) return fail(422, "EMPTY_TRANSCRIPT", "No speech was recognised. Try again, or type the notes.");
    return ok({ text, mode });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return fail(429, "RATE_LIMITED", "The transcription service is busy. Wait a minute, or type the notes.");
    }
    // The provider's own message stays in the server log: it can name keys or account IDs.
    console.warn("[ai] transcribe failed:", err instanceof Error ? err.message.slice(0, 200) : "error");
    if (err instanceof Error && /aborted/i.test(err.message)) {
      return fail(504, "TRANSCRIPTION_TIMEOUT", "Transcription timed out. Try a shorter clip.");
    }
    const status = providerStatus(err);
    if (status === 400 || status === 415) {
      return fail(400, "UNSUPPORTED_FORMAT", "The audio could not be read. Use an mp3, m4a, wav or webm file.");
    }
    if (status === 413) return fail(400, "INVALID_INPUT", "The audio must be under 25 MB.");
    if (status === 401 || status === 403) {
      return fail(503, "TRANSCRIPTION_UNAVAILABLE", "Transcription is not set up correctly on the server. Type the notes instead.");
    }
    return fail(502, "TRANSCRIPTION_FAILED", "Could not transcribe the audio. Type the notes instead.");
  } finally {
    clearTimeout(timer);
  }
}
