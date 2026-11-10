import { emitAndRun } from "@/lib/agent/runner";
import { BookingInputSchema } from "@/lib/agent/schemas";
import { callTool } from "@/lib/agent/tools";
import { demoNow } from "@/lib/clock";
import { DEMO_IDS } from "@/lib/demo/ids";
import { handleError, ok, parseBody } from "@/lib/http";

// POST /api/booking: Pema picks a mentor and a funding option (demo steps 5-8).
// Credit deduction and the booking happen atomically in create_booking();
// a repeated request with the same idempotency_key returns the same booking.
export async function POST(req: Request) {
  const body = await parseBody(req, BookingInputSchema);
  if ("error" in body) return body.error;
  try {
    const now = await demoNow();
    const booking = await callTool(
      "create_booking_request",
      { entrepreneur_id: DEMO_IDS.pema, ...body.data },
      { now },
    );
    const outcome = await emitAndRun({
      event_type: "booking.confirmed",
      entity_type: "booking",
      entity_id: booking.id,
      entrepreneur_id: DEMO_IDS.pema,
      dedupe_key: `booking.confirmed:${booking.id}`,
    });
    return ok({ booking_id: booking.id, outcome });
  } catch (err) {
    return handleError(err);
  }
}
