import { CallJoinInputSchema } from "@/lib/agent/schemas";
import { joinCall } from "@/lib/calls/calls";
import { demoNow } from "@/lib/clock";
import { handleError, ok, parseBody } from "@/lib/http";
import { wrongSide } from "@/lib/viewer";

// POST /api/calls/join { booking_id, role: "mentor" | "entrepreneur" }
// Only for a CONFIRMED booking, only its two participants. Creates the room on
// the first join. Returns { call_id, provider, livekit: { url, token } | null,
// recording, server_time_ms, part_seconds }. The token is a personal pass for
// this room only (null when no video provider is set up).
export async function POST(req: Request) {
  const body = await parseBody(req, CallJoinInputSchema);
  if ("error" in body) return body.error;
  const denied = await wrongSide(body.data.role);
  if (denied) return denied;
  try {
    return ok(await joinCall(body.data.booking_id, body.data.role, await demoNow()));
  } catch (err) {
    return handleError(err);
  }
}
