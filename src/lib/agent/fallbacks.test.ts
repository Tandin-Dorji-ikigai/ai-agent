import { describe, expect, it } from "vitest";
import {
  DEMO_BLOCKER_REPLY,
  DEMO_DONE_REPLY,
  DEMO_EXTRACTED_ACTIONS,
  DEMO_FAST_FORWARD_DAYS,
  DEMO_OBSTACLE_REPLY,
  DEMO_ON_TRACK_REPLY,
  DEMO_SESSION_NOTES,
  PEMA_ASSESSMENT_ANSWERS,
  demoReplyFor,
} from "../demo/fixtures";
import { DEMO_IDS } from "../demo/ids";
import { SEED_MENTORS, SEED_PEMA } from "../demo/seed-data";
import { rankMentors, topMatches } from "../matching/score-mentor";
import type { EntrepreneurRecord } from "../types";
import {
  explainMatch,
  fallbackAssessmentSummary,
  fallbackBriefs,
  fallbackCheckIn,
  fallbackExtraction,
  fallbackFollowUp,
  fallbackMatchExplanations,
} from "./fallbacks";
import {
  AssessmentSummarySchema,
  BriefsSchema,
  ExtractionSchema,
  FollowUpSchema,
  MatchExplanationsSchema,
} from "./schemas";

const pema: EntrepreneurRecord = {
  id: DEMO_IDS.pema,
  full_name: SEED_PEMA.full_name,
  location: SEED_PEMA.location,
  ...PEMA_ASSESSMENT_ANSWERS,
  assessment_summary: null,
  assessment_completed_at: "2026-11-10T00:00:00Z",
};

describe("fallbacks match the live-AI schemas", () => {
  it("assessment summary", () => {
    expect(AssessmentSummarySchema.safeParse(fallbackAssessmentSummary(pema)).success).toBe(true);
  });
  it("match explanations", () => {
    const out = fallbackMatchExplanations(pema, topMatches(pema, SEED_MENTORS));
    expect(MatchExplanationsSchema.safeParse(out).success).toBe(true);
  });
  it("session briefs", () => {
    const out = fallbackBriefs(pema, SEED_MENTORS[0], new Date("2026-11-12T10:00:00Z"));
    expect(BriefsSchema.safeParse(out).success).toBe(true);
  });
  it("action extraction", () => {
    expect(ExtractionSchema.safeParse(fallbackExtraction(DEMO_SESSION_NOTES)).success).toBe(true);
  });
  it("scheduled check-in", () => {
    expect(FollowUpSchema.safeParse(fallbackCheckIn(pema, "Interview five past guests", new Date("2026-11-17T00:00:00Z"))).success).toBe(true);
  });
  it("follow-up session briefs built from progress", () => {
    const agenda = [{ kind: "escalated" as const, text: 'YDF is handling "Permits" (ESC-101).', action_id: "a1" }];
    const out = fallbackBriefs(pema, SEED_MENTORS[0], new Date("2026-11-17T10:00:00Z"), agenda);
    expect(BriefsSchema.safeParse(out).success).toBe(true);
    expect(out.mentor.headline).toMatch(/^Follow-up session/);
  });
  it("overdue follow-up", () => {
    expect(FollowUpSchema.safeParse(fallbackFollowUp(pema, "Confirm permits", 1)).success).toBe(true);
  });
});

describe("match explanations use only supplied evidence", () => {
  it("never claims a factor that scored zero", () => {
    for (const s of rankMentors(pema, SEED_MENTORS)) {
      const text = explainMatch(pema, s);
      if (s.breakdown.sector === 0) expect(text).not.toMatch(/Works with tourism/);
      if (s.breakdown.business_stage === 0) expect(text).not.toMatch(/Works with early-stage/);
      if (s.breakdown.language === 0) expect(text).not.toMatch(/Speaks/);
      if (s.breakdown.language === 5) expect(text).not.toMatch(/Speaks Dzongkha\./);
      if (s.matched_expertise.length === 0) expect(text).toMatch(/Does not list any/);
    }
  });

  it("names exactly the needs the mentor covers", () => {
    const deki = topMatches(pema, SEED_MENTORS)[0];
    const text = explainMatch(pema, deki);
    expect(text).toContain("Covers 2 of your 3 needs: customer validation and market positioning.");
    expect(text).not.toContain("pricing");
  });
});

describe("action extraction fallback", () => {
  it("returns the saved demo actions for the demo notes", () => {
    expect(fallbackExtraction(DEMO_SESSION_NOTES)).toEqual(DEMO_EXTRACTED_ACTIONS);
  });

  it("gives every demo action a SMART measure of success", () => {
    expect(DEMO_EXTRACTED_ACTIONS.actions.every((a) => !!a.success_measure && a.due_in_days > 0)).toBe(true);
  });

  it("makes exactly one demo action overdue after fast-forward", () => {
    const overdue = DEMO_EXTRACTED_ACTIONS.actions.filter((a) => a.due_in_days < DEMO_FAST_FORWARD_DAYS);
    expect(overdue.map((a) => a.title)).toEqual(["Confirm which permits the guided village walk needs"]);
  });

  it("turns bullet lines from other notes into drafts, and invents nothing", () => {
    const out = fallbackExtraction("Talked about stock.\n- Count inventory\n2. Call the supplier");
    expect(out.actions.map((a) => a.title)).toEqual(["Count inventory", "Call the supplier"]);
    expect(fallbackExtraction("Just a chat, nothing agreed.").actions).toEqual([]);
  });
});

describe("demo replies match live-AI wording too", () => {
  it("finds the right pre-filled reply by keyword", () => {
    expect(demoReplyFor("Find out which permits and licences the walk needs", "follow_up")).toBe(DEMO_BLOCKER_REPLY);
    expect(demoReplyFor("Interview 5 past guests", "check_in")).toBe(DEMO_ON_TRACK_REPLY);
    expect(demoReplyFor("Interview 5 past guests", "follow_up")).toBe(DEMO_OBSTACLE_REPLY);
    expect(demoReplyFor("Draft a one-line positioning statement", "check_in")).toBe(DEMO_DONE_REPLY);
    expect(demoReplyFor("Something else entirely", "check_in")).toBe("");
  });
});
