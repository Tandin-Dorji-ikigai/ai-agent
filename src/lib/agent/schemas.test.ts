import { describe, expect, it } from "vitest";
import { SessionCompleteInputSchema } from "./schemas";

const booking_id = "00000000-0000-4000-8000-000000000999";

describe("handover contract: POST /api/session/complete", () => {
  it("accepts typed notes, defaulting the source to typed", () => {
    const r = SessionCompleteInputSchema.safeParse({ booking_id, notes: "Agreed: call two guests." });
    expect(r.success && r.data.source).toBe("typed");
  });

  it("accepts a call transcript on its own", () => {
    const r = SessionCompleteInputSchema.safeParse({ booking_id, transcript: "we agreed to...", source: "call_recording" });
    expect(r.success).toBe(true);
  });

  it("requires notes or a transcript", () => {
    expect(SessionCompleteInputSchema.safeParse({ booking_id }).success).toBe(false);
    expect(SessionCompleteInputSchema.safeParse({ booking_id, notes: "   " }).success).toBe(false);
  });

  it("rejects unknown sources", () => {
    expect(SessionCompleteInputSchema.safeParse({ booking_id, notes: "x", source: "email" }).success).toBe(false);
  });
});
