import { describe, expect, it } from "vitest";
import { agentTimeline, type TimelineInput } from "./agent-timeline";
import type { MentorRequestView } from "./state-types";

const entrepreneur = {
  assessment_completed_at: "2026-11-11T04:00:00Z",
  assessment_summary: "Pema runs a homestay and needs help with pricing.",
  business_stage: "early",
  sector: "tourism",
  expertise_needs: ["pricing", "customer_validation"],
};
const empty: TimelineInput = { entrepreneur: null, matches: [], matched_at: null, compared_count: 0, requests: [], booking: null, reminders: [], action_titles: {} };
const request = (over: Partial<MentorRequestView>): MentorRequestView =>
  ({ id: "r1", kind: "match", status: "pending", mentor: { full_name: "Karma Dorji" }, booking_id: null, scheduled_at: null, responded_at: null, created_at: "2026-11-11T04:01:00Z", ...over }) as MentorRequestView;

describe("agent activity timeline", () => {
  it("before the assessment, shows only what the agent will do, the first as next", () => {
    const items = agentTimeline(empty);
    expect(items.every((i) => i.status !== "done")).toBe(true);
    expect(items[0]).toMatchObject({ kind: "assessed", status: "next" });
    expect(items.some((i) => i.kind === "reminded")).toBe(false);
  });

  it("walks from the assessment to a booked session, oldest first, with real names and times", () => {
    const items = agentTimeline({
      ...empty,
      entrepreneur,
      matches: [{ rank: 2, score: 71, mentor: { full_name: "Sonam Wangmo" } }, { rank: 1, score: 88, mentor: { full_name: "Karma Dorji" } }],
      matched_at: "2026-11-11T04:00:30Z",
      compared_count: 9,
      requests: [
        request({ id: "r1", status: "declined", mentor: { full_name: "Karma Dorji" } as MentorRequestView["mentor"], created_at: "2026-11-11T04:01:00Z" }),
        request({ id: "r2", status: "accepted", mentor: { full_name: "Sonam Wangmo" } as MentorRequestView["mentor"], created_at: "2026-11-11T05:00:00Z", responded_at: "2026-11-11T05:10:00Z", booking_id: "b1", scheduled_at: "2026-11-13T04:00:00Z" }),
      ],
    });
    const done = items.filter((i) => i.status === "done");
    expect(done.map((i) => i.kind)).toEqual(["assessed", "support", "compared", "selected", "requested", "requested", "scheduled"]);
    expect(done[1]).toMatchObject({ title: "Identified the support you need", detail: expect.stringContaining("Pricing") });
    expect(done[2].detail).toContain("Scored 9 verified mentors");
    expect(done[3].detail).toBe("Karma Dorji, 88/100.");
    expect(done[4].detail).toMatch(/Could not take it/);
    expect(done[6].detail).toMatch(/^With Sonam Wangmo, Fri 13 Nov, 10:00, Bhutan time\.$/);
    // Booked: the only step still to come is the reminder about agreed next steps.
    expect(items.filter((i) => i.status !== "done").map((i) => [i.kind, i.status])).toEqual([["reminded", "next"]]);
  });

  it("lists every reminder with the step it was about, in time order", () => {
    const items = agentTimeline({
      ...empty,
      entrepreneur,
      booking: { id: "b0", scheduled_at: "2026-11-12T04:00:00Z", created_at: "2026-11-11T06:00:00Z", mentor: { full_name: "Karma Dorji" } },
      reminders: [
        { id: "m2", created_at: "2026-11-15T03:00:00Z", related_action_id: "a1", body: "How is it going?" },
        { id: "m1", created_at: "2026-11-14T03:00:00Z", related_action_id: null, body: "A friendly check-in." },
      ],
      action_titles: { a1: "Call two past guests" },
    });
    const reminders = items.filter((i) => i.kind === "reminded");
    expect(reminders.map((r) => r.detail)).toEqual(["A friendly check-in.", "About “Call two past guests”."]);
    expect(items.some((i) => i.kind === "scheduled" && i.status === "done")).toBe(true);
    expect(items.some((i) => i.status === "next" && i.kind === "reminded")).toBe(false);
  });

  it("keeps the assessment steps first even when the demo clock was fast-forwarded", () => {
    const items = agentTimeline({
      ...empty,
      entrepreneur: { ...entrepreneur, assessment_completed_at: "2026-11-20T04:00:00Z" },
      matches: [{ rank: 1, score: 88, mentor: { full_name: "Karma Dorji" } }],
      matched_at: "2026-11-11T04:00:30Z",
      requests: [request({ created_at: "2026-11-11T04:01:00Z" })],
    });
    expect(items.filter((i) => i.status === "done").map((i) => i.kind)).toEqual(["assessed", "support", "compared", "selected", "requested"]);
  });
});
