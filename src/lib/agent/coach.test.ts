import { describe, expect, it } from "vitest";
import { PEMA_ASSESSMENT_ANSWERS } from "../demo/fixtures";
import { DEMO_IDS } from "../demo/ids";
import { SEED_MENTORS, SEED_PEMA } from "../demo/seed-data";
import type { EntrepreneurRecord } from "../types";
import { fallbackBriefs } from "./fallbacks";
import { fallbackMission, fallbackReview, fallbackSummary, groundLearnings, nextMove } from "./coach";
import { CoachMissionSchema, CoachReviewSchema, CoachSummarySchema } from "./schemas";

// Someone with no idea yet (the "I don't have an idea yet" path).
const explorer: EntrepreneurRecord = {
  id: DEMO_IDS.pema,
  full_name: SEED_PEMA.full_name,
  ...PEMA_ASSESSMENT_ANSWERS,
  business_name: "",
  business_stage: "idea",
  sector: "agriculture",
  location: "Punakha",
  assessment_summary: null,
  assessment_completed_at: "2026-11-10T00:00:00Z",
};

describe("beginner coach: what happens next is decided in code", () => {
  it("advances on a complete report, retries otherwise, and moves on after the third try", () => {
    expect(nextMove(1, "complete", 0)).toBe("advance");
    expect(nextMove(2, "needs_more", 0)).toBe("retry");
    expect(nextMove(2, "needs_more", 1)).toBe("retry");
    expect(nextMove(2, "needs_more", 2)).toBe("advance"); // third try: keep going
    expect(nextMove(4, "complete", 0)).toBe("hand_over");
    expect(nextMove(4, "needs_more", 2)).toBe("hand_over");
  });
});

describe("beginner coach: no invented facts", () => {
  it("keeps only learnings that share a real word with what the person wrote", () => {
    const reply = "I asked three farmers in Punakha. Two said tomatoes rot before the Sunday market.";
    expect(groundLearnings(["Two farmers lose tomatoes before the market", "Farmers earn Nu. 20,000 a month", "Most people like apps"], reply)).toEqual([
      "Two farmers lose tomatoes before the market",
      "Farmers earn Nu. 20,000 a month",
    ]);
    expect(groundLearnings(["Shops in Thimphu want delivery"], reply)).toEqual([]);
  });
});

describe("beginner coach: saved responses (no AI)", () => {
  it("writes a valid, personalised mission for every step", () => {
    for (const step of [1, 2, 3, 4]) {
      const m = fallbackMission(step, explorer, step > 1 ? ["Tomatoes rot before the market"] : []);
      expect(CoachMissionSchema.parse(m)).toBeTruthy();
    }
    expect(fallbackMission(1, explorer, []).mission).toContain("Punakha");
    expect(fallbackMission(1, explorer, []).mission).toContain("agriculture");
    expect(fallbackMission(2, explorer, ["Tomatoes rot before the market"]).mission).toContain("Tomatoes rot");
  });

  it("accepts a substantial report with the step's key signal, and asks for more otherwise", () => {
    const good = fallbackReview(2, "I asked three farmers. Two said they lose about Nu. 300 of tomatoes a week, one said it is fine.", 0);
    expect(CoachReviewSchema.parse(good).outcome).toBe("complete");
    expect(good.learnings.length).toBeGreaterThan(0);
    const thin = fallbackReview(2, "Talked to people.", 0);
    expect(thin.outcome).toBe("needs_more");
    expect(thin.feedback).toContain("Ask three people");
    expect(fallbackReview(3, "A shared cold box at the market; shop owners would pay about Nu. 100 a week.", 0).outcome).toBe("complete");
    // "Nu. 300" is a price, not the end of a sentence.
    expect(good.learnings.some((l) => l.includes("Nu 300 of tomatoes a week"))).toBe(true);
    expect(good.learnings.every((l) => !/Nu\.$/.test(l))).toBe(true);
  });

  it("writes a valid mentor summary from the steps", () => {
    const steps = [1, 2, 3, 4].map((step) => ({
      step,
      mission: "m",
      status: "done" as const,
      attempts: 1,
      last_reply: `Report for step ${step}`,
      learnings: [`Fact from step ${step}`],
    }));
    const s = CoachSummarySchema.parse(fallbackSummary(explorer, steps));
    expect(s.problem).toBe("Fact from step 1");
    expect(s.idea).toBe("Fact from step 3");
    expect(s.evidence).toEqual(["Fact from step 2", "Fact from step 4"]);
  });

  it("the mentor's brief starts from what the coach found", () => {
    const summary = { problem: "Tomatoes rot before market day", who_has_it: "Farmers in Punakha", idea: "A shared cold box", evidence: ["2 of 3 farmers lose Nu. 300 a week"], questions_for_mentor: ["How do I price the cold box?"] };
    const brief = fallbackBriefs(explorer, SEED_MENTORS[0], new Date("2026-11-12T10:00:00Z"), [], summary);
    expect(brief.mentor.about).toContain("A shared cold box");
    expect(brief.mentor.about).toContain("2 of 3 farmers");
    expect(brief.mentor.focus[0]).toBe("How do I price the cold box?");
  });
});
