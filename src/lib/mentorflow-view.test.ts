import { describe, expect, it } from "vitest";
import { SEED_MENTORS } from "./demo/seed-data";
import { requestSummary } from "./mentorflow-view";
import type { DemoState, MentorRequestView, RequestRoundView } from "./state-types";

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

  it("a follow-up the mentor declined: says so plainly, with the reason, and who to ask instead", () => {
    const ugyen = SEED_MENTORS.find((m) => m.full_name === "Ugyen Lhendup")!;
    const followUp = { ...req({}).mentee_summary, follow_up: true };
    const s = requestSummary({
      booking: null,
      matches: [{ mentor: deki }, { mentor: { ...sonam, slots_remaining: 0 } }, { mentor: ugyen }] as DemoState["matches"],
      request_round: round({
        kind: "direct",
        status: "declined",
        requests: [req({ kind: "direct", status: "declined", decline_reason: "no_time", decline_note: "Busy with harvest.", mentee_summary: followUp })],
      }),
    });
    expect(s.phase).toBe("declined");
    expect(s.headline).toBe("Deki can’t take your follow-up session right now");
    expect(s.detail).toBe("Reason: no time this week. Deki wrote: “Busy with harvest.” You can ask Deki again later, or ask Ugyen Lhendup instead.");
    expect(s.alternative?.full_name).toBe("Ugyen Lhendup"); // Deki was asked; Sonam has no open sessions
  });

  it("a chosen mentor who did not reply in time", () => {
    const s = requestSummary({
      booking: null, matches: [],
      request_round: round({ kind: "direct", status: "declined", requests: [req({ kind: "direct", status: "expired" })] }),
    });
    expect(s.headline).toBe("Deki did not reply to your session request");
    expect(s.detail).toBe("Deki did not reply in time. You can ask Deki again later.");
    expect(s.alternative).toBeNull();
  });

  it("after the session: complete, not booked", () => {
    const booking = { status: "completed", scheduled_at: "2026-11-12T04:00:00.000Z" } as DemoState["booking"];
    const s = requestSummary({ booking, matches: [], request_round: round({ status: "accepted", requests: [req({ status: "accepted" })] }) });
    expect(s.headline).toBe("Your session is complete");
  });
});
