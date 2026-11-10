import { describe, expect, it } from "vitest";
import { DEMO_CALL_TRANSCRIPT, buildDemoLongTranscript } from "../demo/fixtures";
import { SINGLE_PASS_MAX_CHARS } from "./schemas";
import { CHUNK_CHARS, findAgreements, heuristicExtraction, normaliseSpace, parseDueInDays, splitIntoChunks } from "./transcripts";

describe("splitting long transcripts", () => {
  const long = buildDemoLongTranscript();

  it("the long sample really is too long for one pass", () => {
    expect(long.length).toBeGreaterThan(SINGLE_PASS_MAX_CHARS + 4100);
  });

  it("keeps every part under the size limit, in order, losing nothing", () => {
    const chunks = splitIntoChunks(long);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= CHUNK_CHARS)).toBe(true);
    expect(chunks.join(" ")).toBe(normaliseSpace(long));
  });

  it("splits a single huge sentence by words", () => {
    const chunks = splitIntoChunks("word ".repeat(3000), 1000);
    expect(chunks.every((c) => c.length <= 1000)).toBe(true);
  });
});

describe("timeframes", () => {
  it.each([
    ["within four days", 4],
    ["within a week", 7],
    ["in two weeks", 14],
    ["within 10 days", 10],
    ["tomorrow", 1],
    ["by next week", 7],
    ["within a week, no wait, make that two weeks", 14],
    ["no timeframe here", null],
  ])("%s -> %s", (text, days) => {
    expect(parseDueInDays(text)).toBe(days);
  });
});

describe("rule-based agreement finder (fallback)", () => {
  it("finds the three demo agreements with the right due dates", () => {
    const found = findAgreements(DEMO_CALL_TRANSCRIPT);
    expect(found.map((a) => a.due_in_days)).toEqual([4, 7, 10]);
    expect(found[0].what.toLowerCase()).toContain("permit");
  });

  it("marks mentor offers as mentor-owned and skips ideas they decided against", () => {
    const text =
      "I'll introduce you to a tour operator in Paro by next week. You send me your price sheet within two days. " +
      "We also discussed hiring a second guide, but decided not now.";
    const found = findAgreements(text);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({ who: "mentor", due_in_days: 7 });
    expect(found[1]).toMatchObject({ who: "entrepreneur", due_in_days: 2 });
    expect(found.some((a) => /hiring|guide/i.test(a.what))).toBe(false);
  });

  it("reads 'nothing agreed' as no agreement", () => {
    expect(findAgreements("Just a chat, nothing agreed. We did not agree on next steps.")).toEqual([]);
  });

  it("invents nothing when nothing was agreed", () => {
    const out = heuristicExtraction("We caught up about the festival. Business has been steady. It was a good chat.");
    expect(out.actions).toEqual([]);
  });

  it("finds the four agreements in the long sample and skips the website", () => {
    const found = findAgreements(buildDemoLongTranscript());
    expect(found.map((a) => a.due_in_days)).toEqual([5, 1, 7, 10]);
    expect(found.find((a) => a.due_in_days === 1)?.who).toBe("mentor");
    expect(found.some((a) => /website/i.test(a.what))).toBe(false);
  });
});
