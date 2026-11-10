import { describe, expect, it } from "vitest";
import { formatLabeled, labelMentorAndEntrepreneur, partitionLines, transcriptLines } from "./speakers";

const CALL =
  "Tell me how the bookings went. We had four guests, but I do not know who to focus on. Let's fix that. " +
  "Please interview five past guests this week. Okay, I will do it by Friday.";

describe("speaker labelling keeps the exact words", () => {
  it("splits Whisper segments into sentences, so a short reply gets its own label", () => {
    const lines = transcriptLines("", [
      { text: "We had four guests, but I do not know who to focus on. Let's fix that." },
      { text: "Please interview five past guests this week." },
    ]);
    expect(lines).toEqual(["We had four guests, but I do not know who to focus on.", "Let's fix that.", "Please interview five past guests this week."]);
  });

  it("joins labelled lines into turns without changing or dropping a word", () => {
    const lines = transcriptLines(CALL);
    const out = formatLabeled(lines, ["Mentor", "Entrepreneur", "Mentor", "Mentor", "Entrepreneur"]);
    expect(out).toBe(
      "[Mentor] Tell me how the bookings went.\n" +
        "[Entrepreneur] We had four guests, but I do not know who to focus on.\n" +
        "[Mentor] Let's fix that. Please interview five past guests this week.\n" +
        "[Entrepreneur] Okay, I will do it by Friday.",
    );
    expect(out.replace(/\[(Mentor|Entrepreneur)\] /g, "").replace(/\n/g, " ")).toBe(CALL);
  });

  it("splits long calls into parts by line count and size, keeping every line once, in order", () => {
    const lines = Array.from({ length: 300 }, (_, i) => `Line ${i} ${"x".repeat(50)}.`);
    const parts = partitionLines(lines, 120, 12_000);
    expect(parts.flat()).toEqual(lines);
    expect(parts.every((p) => p.length <= 120)).toBe(true);
    expect(partitionLines(lines, 1000, 1_000).every((p) => p.join(" ").length <= 1_000)).toBe(true);
  });
});

describe("when labelling cannot run, the transcript is still returned", () => {
  it("returns the plain transcript, never one big [Mentor] block (saved-response mode)", async () => {
    const out = await labelMentorAndEntrepreneur(CALL, undefined, Date.now() + 60_000);
    expect(out).toEqual({ text: CALL, labeled: false });
  });

  it("returns the plain transcript when there is no time left", async () => {
    const out = await labelMentorAndEntrepreneur(CALL, undefined, Date.now() - 1);
    expect(out).toEqual({ text: CALL, labeled: false });
  });
});
