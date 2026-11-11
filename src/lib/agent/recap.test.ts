import { describe, expect, it } from "vitest";
import { fallbackRecap, groundRecap, recapInput, RECAP_INPUT_MAX } from "./recap";
import { SessionRecapSchema } from "./schemas";

const talk = [
  "[Mentor] Visitors already pass through your village. Community tourism could be an opportunity.",
  "[Entrepreneur] I like the idea of village walks with local food. That makes me feel more confident.",
].join("\n");

describe("recapInput", () => {
  it("keeps a normal session whole", () => {
    expect(recapInput(`  ${talk}  `)).toBe(talk);
  });

  it("keeps the start and the end of a very long session", () => {
    const long = `START ${"a".repeat(RECAP_INPUT_MAX)} END`;
    const out = recapInput(long);
    expect(out.length).toBeLessThan(RECAP_INPUT_MAX + 100);
    expect(out.startsWith("START")).toBe(true);
    expect(out.endsWith("END")).toBe(true);
    expect(out).toContain("middle of the session is left out");
  });
});

describe("groundRecap", () => {
  it("drops points that share no real word with what was said", () => {
    const out = groundRecap(
      { discussed: ["Community tourism in the village", "Opening a bank account in Paro"], achieved: ["Feels more confident about village walks", "Signed a contract"] },
      talk,
    );
    expect(out).toEqual({ discussed: ["Community tourism in the village"], achieved: ["Feels more confident about village walks"] });
  });

  it("gives up (so the fallback is used) when nothing discussed is grounded", () => {
    expect(groundRecap({ discussed: ["Export permits"], achieved: [] }, talk)).toBeNull();
  });
});

describe("fallbackRecap", () => {
  it("uses the agent's summary as what was discussed, and claims nothing achieved", () => {
    const out = fallbackRecap(talk, "The mentee is interested in community tourism. The mentor suggested starting small.");
    expect(SessionRecapSchema.parse(out)).toEqual({
      discussed: ["The mentee is interested in community tourism.", "The mentor suggested starting small."],
      achieved: [],
    });
  });

  it("falls back to the first lines of the conversation, without speaker labels", () => {
    const out = fallbackRecap(talk, null);
    expect(out.discussed[0]).toBe("Visitors already pass through your village.");
    expect(out.discussed.every((d) => !d.startsWith("["))).toBe(true);
  });

  it("ignores a summary that only says no actions were found", () => {
    expect(fallbackRecap(talk, "No clear agreed actions were found in the call.").discussed[0]).toBe("Visitors already pass through your village.");
  });

  it("is still valid when there is nothing to use", () => {
    expect(SessionRecapSchema.parse(fallbackRecap("ok", null)).discussed).toHaveLength(1);
  });
});
