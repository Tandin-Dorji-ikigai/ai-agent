// What Groq Whisper accepts. Anything else (for example iPhone .mov, .mkv, .aac)
// is refused before a long upload fails at Groq.

/** Groq's free-tier upload limit. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

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

export const UNSUPPORTED_FORMAT_MESSAGE = "Use an mp3, m4a, wav, ogg, flac, webm or mp4 file. Other formats (such as .mov) are not accepted.";

export function isAcceptedFormat(file: { type: string }, filename: string): boolean {
  return ACCEPTED_EXTENSIONS.test(filename) || ACCEPTED_TYPES.has(file.type.split(";")[0].trim().toLowerCase());
}
