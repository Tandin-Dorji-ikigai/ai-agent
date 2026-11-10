import { describe, expect, it } from "vitest";
import { extractionFromNotes, fixOwner, groundActions, ownersFromSource, renderCondensed } from "./extract";
import { budgetWaitMs } from "./llm";
import { ExtractionSchema } from "./schemas";

const notes = [
  { agreements: [{ what: "Call the three guides for referrals", who: "entrepreneur" as const, timeframe: "within five days" }], context: ["Rooms empty in November"] },
  {
    agreements: [
      { what: "Call the three guides for referrals", who: "entrepreneur" as const, timeframe: "five days" },
      { what: "Send the interview kit", who: "mentor" as const, timeframe: "tomorrow" },
    ],
    context: ["Decided not to build a website now"],
  },
];

describe("combining the parts of a long call", () => {
  it("merges duplicate agreements and keeps owners and due dates", () => {
    const out = extractionFromNotes(notes, 2);
    expect(ExtractionSchema.safeParse(out).success).toBe(true);
    expect(out.actions).toEqual([
      { title: "Call the three guides for referrals", owner: "entrepreneur", due_in_days: 5 },
      { title: "Send the interview kit", owner: "mentor", due_in_days: 1 },
    ]);
  });

  it("renders compact notes for the final AI step, including decisions against", () => {
    const text = renderCondensed(notes, 2);
    expect(text).toContain("Condensed from a 2-part call transcript.");
    expect(text.match(/Call the three guides/g)).toHaveLength(1);
    expect(text).toContain("Decided not to build a website now");
    expect(text).toContain("Context (background only, not actions):");
  });
});

describe("free-tier pacing (tokens per minute)", () => {
  const now = 100_000;
  it("goes straight away when there is room", () => {
    expect(budgetWaitMs([], now, 3000, 8000)).toBe(0);
    expect(budgetWaitMs([{ at: now - 1000, tokens: 2000 }], now, 3000, 8000)).toBe(0);
  });

  it("waits until enough of the last minute's usage expires", () => {
    const entries = [
      { at: now - 50_000, tokens: 3000 },
      { at: now - 10_000, tokens: 3000 },
    ];
    const wait = budgetWaitMs(entries, now, 2000, 8000);
    expect(wait).toBeGreaterThan(9_000);
    expect(wait).toBeLessThanOrEqual(10_050);
  });

  it("ignores usage older than a minute", () => {
    expect(budgetWaitMs([{ at: now - 61_000, tokens: 7000 }], now, 3000, 8000)).toBe(0);
  });
});

describe("owners and grounding for long calls", () => {
  it("decides the owner from the speaker's words", () => {
    expect(fixOwner({ what: "you call the three guides for referrals", who: "mentor" }).who).toBe("entrepreneur");
    expect(fixOwner({ what: "I'll send you the interview kit", who: "entrepreneur" }).who).toBe("mentor");
    expect(fixOwner({ what: "draft a price list", who: "unclear" }).who).toBe("entrepreneur");
  });

  it("drops final actions that match no agreement, and takes owners from the agreements", () => {
    const agreements = [
      { what: "you call the three guides you worked with for two guest referrals", who: "entrepreneur" as const },
      { what: "you draft a simple low-season price list for the rooms", who: "entrepreneur" as const },
    ];
    const out = groundActions(
      [
        { title: "Call three past guides for referrals", owner: "mentor", due_in_days: 5 },
        { title: "Consider adding cooking participation", owner: "entrepreneur", due_in_days: 7 },
        { title: "Draft low-season price list", owner: "mentor", due_in_days: 10 },
      ],
      agreements,
    );
    expect(out.map((a) => [a.title, a.owner])).toEqual([
      ["Call three past guides for referrals", "entrepreneur"],
      ["Draft low-season price list", "entrepreneur"],
    ]);
  });
});

describe("owners for short notes", () => {
  it("takes the owner from the source sentence when the rules recognise it", () => {
    const notes =
      "We agreed Dorji will ask three shops in town what they pay per kilo, within four days. I'll send the bookkeeping guide tomorrow.";
    const out = ownersFromSource(
      [
        { title: "Ask three shops for cheese price per kilo", owner: "mentor", due_in_days: 4 },
        { title: "Send bookkeeping guide", owner: "entrepreneur", due_in_days: 1 },
        { title: "Something the rules did not see", owner: "mentor", due_in_days: 7 },
      ],
      notes,
    );
    expect(out.map((a) => a.owner)).toEqual(["entrepreneur", "mentor", "mentor"]);
  });
});
