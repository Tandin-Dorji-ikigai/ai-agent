import { describe, expect, it } from "vitest";
import { DEMO_CALL_TRANSCRIPT, buildDemoLongTranscript } from "../demo/fixtures";
import { SINGLE_PASS_MAX_CHARS } from "./schemas";
import { CHUNK_CHARS, bhutanToday, bhutanWeekday, findAgreements, heuristicExtraction, normaliseSpace, parseDueInDays, splitIntoChunks } from "./transcripts";

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

describe("owners when the speaker is known ([Mentor] / [Entrepreneur] lines)", () => {
  it("a speaker's own 'I will' is theirs; 'you' is the other person's; instructions are the entrepreneur's", async () => {
    const { findAgreements } = await import("./transcripts");
    const call = [
      "[Mentor] So we agree on three things. Within four days, check which permits the walk needs.",
      "[Entrepreneur] Okay, I will interview five past guests by Friday.",
      "[Mentor] And I will send you a short pricing worksheet tomorrow.",
      "[Entrepreneur] So you will introduce me to the guide association next week.",
    ].join("\n");
    const who = Object.fromEntries(findAgreements(call).map((a) => [a.what.split(" ").slice(0, 3).join(" "), a.who]));
    expect(who).toEqual({
      "Check which permits": "entrepreneur", // the mentor's instruction
      "Interview five past": "entrepreneur", // Pema's own "I will"
      "Send you a": "mentor", // the mentor's own "I will"
      "Introduce me to": "mentor", // Pema says "you will" to the mentor
    });
  });

  it("unlabelled text keeps the old rule ('I'll send' = the mentor)", async () => {
    const { findAgreements } = await import("./transcripts");
    expect(findAgreements("I will send you a short pricing worksheet tomorrow.")[0]?.who).toBe("mentor");
  });
});

describe("day names count from today in Bhutan", () => {
  // Wednesday 11 Nov 2026, 03:19 in Bhutan = Tuesday 21:19 UTC: the weekday must be Bhutan's.
  const wednesday = new Date("2026-11-10T21:19:00Z");

  it("knows today in Bhutan, whatever the server's time zone", () => {
    expect(bhutanWeekday(wednesday)).toBe(3);
    expect(bhutanToday(wednesday)).toBe("Wednesday 11 November 2026");
  });

  it.each([
    ["I will call five recent guests by Friday", 2],
    ["I will send you the pricing sheet by Wednesday", 7],
    ["I will rewrite it by next Monday, after the interviews", 5],
    ["I will introduce you to him by email this week", 4],
    ["I will send you the questions by tomorrow", 1],
    ["I will test both prices over the next two weeks", 14],
    ["on Saturday, no wait, by Thursday", 1],
  ])("%s -> %s", (text, days) => {
    expect(parseDueInDays(text, wednesday)).toBe(days);
  });

  it("without today, a day name still means about a week (as before)", () => {
    expect(parseDueInDays("I will call them by Friday")).toBe(7);
  });

  it("the rule-based reader uses today too", () => {
    const found = findAgreements("[Entrepreneur] I will call five recent guests by Friday.", wednesday);
    expect(found[0]?.due_in_days).toBe(2);
  });
});
