import { describe, expect, it } from "vitest";
import { fallbackRecap, finishRecap, groundRecap, recapInput, RECAP_INPUT_MAX, saidFollowUpDays } from "./recap";
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
      {
        discussed: ["Community tourism in the village", "Opening a bank account in Paro"],
        achieved: ["Feels more confident about village walks", "Signed a contract"],
        advice: ["Offer village walks with local food", "Register a company in Singapore"],
        next_step: "Plan one village walk with local food",
        follow_up_in_days: 21,
        follow_up_reason: "Time to try a first village walk",
      },
      talk,
    );
    expect(out).toEqual({
      discussed: ["Community tourism in the village"],
      achieved: ["Feels more confident about village walks"],
      advice: ["Offer village walks with local food"],
      next_step: "Plan one village walk with local food",
      follow_up_in_days: 21,
      follow_up_reason: "Time to try a first village walk",
    });
  });

  it("fills what was discussed from the conversation when none of the AI's topics are grounded", () => {
    const out = groundRecap({ discussed: ["Export permits"], achieved: [], advice: [], next_step: "Apply for an export licence" }, talk);
    expect(out.discussed[0]).toBe("Visitors already pass through your village.");
    expect(out.next_step).toBeUndefined();
  });
});

describe("fallbackRecap", () => {
  it("uses the agent's summary as what was discussed, and claims nothing achieved", () => {
    const out = fallbackRecap(talk, "The mentee is interested in community tourism. The mentor suggested starting small.");
    expect(out.discussed).toEqual(["The mentee is interested in community tourism.", "The mentor suggested starting small."]);
    expect(out.achieved).toEqual([]);
  });

  it("falls back to the first lines of the conversation, without speaker labels", () => {
    const out = fallbackRecap(talk, null);
    expect(out.discussed[0]).toBe("Visitors already pass through your village.");
    expect(out.discussed.every((d) => !d.startsWith("["))).toBe(true);
  });

  it("ignores a summary that only says no actions were found", () => {
    expect(fallbackRecap(talk, "No clear agreed actions were found in the call.").discussed[0]).toBe("Visitors already pass through your village.");
  });

  it("takes the advice from what the mentor said, never from the entrepreneur", () => {
    const call = [
      "[Mentor] I suggest you start with two small walks before adding meals.",
      "[Entrepreneur] You should see how many visitors came last year.",
      "[Mentor] This week, ask three past guests what they liked most.",
    ].join("\n");
    const out = fallbackRecap(call, null);
    expect(out.advice).toEqual(["I suggest you start with two small walks before adding meals."]);
    expect(out.next_step).toBe("This week, ask three past guests what they liked most.");
  });

  it("reads advice from the mentor's own typed notes", () => {
    const out = fallbackRecap("Mentor notes:\nAdvised Pema to focus on weekend visitors first. We talked about prices.", null);
    expect(out.advice).toEqual(["Advised Pema to focus on weekend visitors first."]);
  });

  it("is still a valid summary when there is nothing to use", () => {
    const out = finishRecap(fallbackRecap("ok", null), "ok", new Date("2026-11-11T04:00:00Z"));
    expect(out.discussed).toHaveLength(1);
    expect(out.advice).toEqual([]);
    expect(out.next_step).toBeNull();
  });
});

describe("recommended follow-up date", () => {
  const held = new Date("2026-11-11T04:00:00Z"); // Wed 11 Nov, 10:00 in Bhutan

  it("is the time they agreed, when they said one", () => {
    expect(saidFollowUpDays("[Mentor] Let's meet again in two weeks to see how it went.")).toBe(14);
    expect(saidFollowUpDays("[Mentor] We can talk again next month.")).toBe(30);
    expect(saidFollowUpDays("[Entrepreneur] Can we have a session in 10 days?")).toBe(10);
    expect(saidFollowUpDays("[Mentor] Prices went up in two weeks last year.")).toBeNull();
    const out = finishRecap({ discussed: ["Prices"], achieved: [], advice: [], follow_up_in_days: 30 }, "[Mentor] Let's meet again in three weeks.", held);
    expect(out.follow_up_on).toBe("2026-12-02");
    expect(out.follow_up_reason).toBe("You talked about meeting again around then.");
  });

  it("otherwise is the agent's recommendation, kept between one week and two months", () => {
    const soon = finishRecap({ discussed: ["Prices"], achieved: [], advice: [], follow_up_in_days: 2, follow_up_reason: "Quick check" }, "We talked about prices.", held);
    expect(soon.follow_up_on).toBe("2026-11-18");
    const late = finishRecap({ discussed: ["Prices"], achieved: [], advice: [], follow_up_in_days: 200 }, "We talked about prices.", held);
    expect(late.follow_up_on).toBe("2027-01-10");
  });

  it("is two weeks when nobody said and the agent gave none", () => {
    const out = finishRecap({ discussed: ["Prices"], achieved: [], advice: [] }, "We talked about prices.", held);
    expect(out.follow_up_on).toBe("2026-11-25");
    expect(SessionRecapSchema.parse(out)).toEqual(out);
  });
});
