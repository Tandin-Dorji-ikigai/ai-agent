import { describe, expect, it } from "vitest";
import { DEMO_CALL_TURNS, demoTrackSegments } from "../demo/fixtures";
import { mergeTracks, textSimilarity } from "./merge";

const T0 = Date.UTC(2026, 10, 12, 4, 0, 0);

describe("merging each person's recording into one conversation", () => {
  it("orders lines by time across both microphones and labels each speaker for certain", () => {
    const out = mergeTracks([
      { role: "mentor", startedAtMs: T0, segments: [{ start: 0, end: 4, text: "How did the bookings go?" }, { start: 12, end: 16, text: "I will send you a pricing worksheet." }] },
      // The entrepreneur's device started recording 2 seconds later.
      { role: "entrepreneur", startedAtMs: T0 + 2000, segments: [{ start: 3, end: 8, text: "We had four guests." }, { start: 16, end: 19, text: "Great, thank you." }] },
    ]);
    expect(out.text).toBe(
      "[Mentor] How did the bookings go?\n[Entrepreneur] We had four guests.\n[Mentor] I will send you a pricing worksheet.\n[Entrepreneur] Great, thank you.",
    );
  });

  it("joins one person's consecutive lines into one turn, across parts", () => {
    const out = mergeTracks([
      { role: "mentor", startedAtMs: T0, segments: [{ start: 0, end: 5, text: "First point." }] },
      { role: "mentor", startedAtMs: T0 + 300_000, segments: [{ start: 1, end: 4, text: "After the break." }] },
      { role: "mentor", startedAtMs: T0, segments: [{ start: 6, end: 9, text: "Second point." }] },
    ]);
    expect(out.turns).toHaveLength(1);
    expect(out.text).toBe("[Mentor] First point. Second point. After the break.");
  });

  it("drops an echo of the other person's voice, keeping the clearer copy", () => {
    const out = mergeTracks([
      { role: "mentor", startedAtMs: T0, segments: [{ start: 0, end: 5, text: "Interview five past guests this week.", avg_logprob: -0.2 }] },
      // The mentor's voice leaked into Pema's microphone from her speaker.
      { role: "entrepreneur", startedAtMs: T0, segments: [{ start: 0.4, end: 5.2, text: "interview five past guests this week", avg_logprob: -0.9 }] },
    ]);
    expect(out.text).toBe("[Mentor] Interview five past guests this week.");
    expect(out.dropped.echo).toBe(1);
  });

  it("keeps two different things said at the same time", () => {
    const out = mergeTracks([
      { role: "mentor", startedAtMs: T0, segments: [{ start: 0, end: 4, text: "Let us look at pricing." }] },
      { role: "entrepreneur", startedAtMs: T0, segments: [{ start: 1, end: 3, text: "Sorry, one question first." }] },
    ]);
    expect(out.turns).toHaveLength(2);
    expect(out.dropped.echo).toBe(0);
  });

  it("drops words Whisper invented during silence", () => {
    const out = mergeTracks([
      { role: "entrepreneur", startedAtMs: T0, segments: [{ start: 0, end: 2, text: "Thanks for watching!", no_speech_prob: 0.9 }, { start: 5, end: 8, text: "I will call the guides." }] },
    ]);
    expect(out.text).toBe("[Entrepreneur] I will call the guides.");
    expect(out.dropped.silence).toBe(1);
  });

  it("rebuilds the saved demo call in order from the two saved recordings", () => {
    const out = mergeTracks([
      { role: "entrepreneur", startedAtMs: T0, segments: demoTrackSegments("entrepreneur") },
      { role: "mentor", startedAtMs: T0, segments: demoTrackSegments("mentor") },
    ]);
    expect(out.turns.map((t) => t.role)).toEqual(["mentor", "entrepreneur", "mentor", "entrepreneur"]);
    expect(out.text.replace(/\[(Mentor|Entrepreneur)\] /g, "").replace(/\n/g, " ")).toBe(DEMO_CALL_TURNS.map((t) => t.text).join(" "));
  });

  it("measures word overlap for echo detection", () => {
    expect(textSimilarity("Interview five past guests", "interview five past guests")).toBe(1);
    expect(textSimilarity("Let us look at pricing", "Sorry, one question first")).toBe(0);
  });
});
