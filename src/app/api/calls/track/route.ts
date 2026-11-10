import { CallTrackFieldsSchema } from "@/lib/agent/schemas";
import { MAX_AUDIO_BYTES, UNSUPPORTED_FORMAT_MESSAGE, isAcceptedFormat } from "@/lib/audio/formats";
import { uploadPart } from "@/lib/calls/calls";
import { fail, handleError, ok } from "@/lib/http";
import { wrongSide } from "@/lib/viewer";

// POST /api/calls/track (multipart): call_id, role, part (0, 1, 2, ...),
// started_at_ms (when this part started, in SERVER time), file.
// Each browser uploads ONLY its own microphone, in parts of about 5 minutes,
// after both people agreed. Each part is transcribed and the audio discarded.
// Returns { part_id, segments, source }. Uploading the same part again is safe.
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "INVALID_INPUT", "Send the recording as form data.");
  }
  const fields = CallTrackFieldsSchema.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  if (!fields.success) {
    const first = fields.error.issues[0];
    return fail(400, "INVALID_INPUT", first ? `${first.path.join(".")}: ${first.message}` : "Invalid input.");
  }
  const denied = await wrongSide(fields.data.role);
  if (denied) return denied;
  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "INVALID_INPUT", "No recording received.");
  if (file.size === 0 || file.size > MAX_AUDIO_BYTES) return fail(400, "INVALID_INPUT", "Each part must be under 25 MB. Upload shorter parts.");
  const filename = file.name || "track.webm";
  if (!isAcceptedFormat(file, filename)) return fail(400, "UNSUPPORTED_FORMAT", UNSUPPORTED_FORMAT_MESSAGE);
  try {
    const { call_id, role, part, started_at_ms } = fields.data;
    return ok(await uploadPart({ callId: call_id, role, part, startedAtMs: started_at_ms, file, filename }));
  } catch (err) {
    return handleError(err);
  }
}
