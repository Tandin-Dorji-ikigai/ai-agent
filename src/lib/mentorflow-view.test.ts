import { describe, expect, it } from "vitest";
import { SEED_MENTORS } from "./demo/seed-data";
import { requestSummary } from "./mentorflow-view";
import type { MentorRequestView, RequestRoundView } from "./state-types";

const deki = SEED_MENTORS[0];
const sonam = SEED_MENTORS.find((m) => m.full_name === "Sonam Choden")!;

function req(over: Partial<MentorRequestView>): MentorRequestView {
  return {
    id: crypto.randomUUID(), round_id: "r1", attempt: 1, kind: "match", status: "pending", mentor: deki, score: 88,
    funding_type: "ydf_credit", fee: 1500,
    mentee_summary: { full_name: "Pema Yangchen", location: null, business_name: null, business_stage: "early", sector: "tourism", needs: [], challenge: null, preferred_language: "dz", why: [], follow_up: false },
    offered_slots: [], decline_reason: null, decline_note: null, scheduled_at: null, booking_id: null,
    expires_at: "2026-11-12T09:00:00.000Z", responded_at: null, created_at: "2026-11-10T09:00:00.000Z",
    ...over,
  };
}
const round = (over: Partial<RequestRoundView>): RequestRoundView => ({
  round_id: "r1", kind: "match", status: "waiting", requests: [], next_mentor: null, max_requests: 3, escalation_code: null, ...over,
});

describe("what Pema's screens say about the mentor request", () => {
  it("while the best match decides: who, by when, how it is paid, and who is next", () => {
    const s = requestSummary({ booking: null, matches: [], request_round: round({ requests: [req({})], next_mentor: { mentor: sonam, score: 77 } }) });
    expect(s.phase).toBe("waiting");
    expect(s.headline).toBe("Asking Deki Wangmo");
    expect(s.detail).toContain("your best match");
    expect(s.detail).toContain("reply by Thu 12 Nov");
    expect(s.detail).toContain("paid with your YDF credit");
    expect(s.detail).toContain("I will ask Sonam Choden next");
  });

  it("after a decline: the history says why, and the next mentor is being asked", () => {
    const s = requestSummary({
      booking: null, matches: [],
      request_round: round({ requests: [req({ status: "declined", decline_reason: "no_time" }), req({ attempt: 2, mentor: sonam })] }),
    });
    expect(s.timeline.map((t) => t.outcome)).toEqual(["Declined: no time this week", "Deciding, reply due Thu 12 Nov"]);
    expect(s.detail).toContain("your next best match");
  });

  it("when handed to YDF, says so with the escalation code", () => {
    const s = requestSummary({ booking: null, matches: [], request_round: round({ status: "escalated", escalation_code: "ESC-101", requests: [req({ status: "declined" })] }) });
    expect(s.phase).toBe("escalated");
    expect(s.detail).toContain("ESC-101");
  });

  it("with matches but no request yet, says the agent is asking (it starts by itself)", () => {
    expect(requestSummary({ booking: null, matches: [{} as never], request_round: null }).headline).toBe("Asking your best match");
  });
});
