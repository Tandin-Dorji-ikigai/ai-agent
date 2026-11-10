import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetAiGuards, aiStep } from "./ai";
import { BudgetWaitTooLongError, RateLimitError } from "./llm";
import { FollowUpSchema } from "./schemas";

const fallback = () => ({ body: "Saved fallback message." });

beforeEach(() => {
  _resetAiGuards();
  process.env.GROQ_API_KEY = "test-key-not-real";
});

afterEach(() => {
  delete process.env.AI_MODE;
  delete process.env.GROQ_API_KEY;
  delete process.env.AI_DAILY_CALL_LIMIT;
});

describe("aiStep", () => {
  it("uses the fallback in fixture mode without calling the AI", async () => {
    let called = false;
    const r = await aiStep({
      task: "t",
      schema: FollowUpSchema,
      fallback,
      live: async () => {
        called = true;
        return { body: "live" };
      },
    });
    expect(called).toBe(false);
    expect(r).toMatchObject({ source: "fallback", fallbackReason: "fixture_mode", value: fallback() });
  });

  it("returns live output when it is valid", async () => {
    process.env.AI_MODE = "live";
    const r = await aiStep({ task: "t", schema: FollowUpSchema, fallback, live: async () => ({ body: "Live message." }) });
    expect(r).toMatchObject({ source: "live_ai", value: { body: "Live message." } });
  });

  it("falls back when the AI times out", async () => {
    process.env.AI_MODE = "live";
    const r = await aiStep({
      task: "t",
      schema: FollowUpSchema,
      fallback,
      timeoutMs: 20,
      live: () => new Promise((resolve) => setTimeout(() => resolve({ body: "too late" }), 500)),
    });
    expect(r).toMatchObject({ source: "fallback", fallbackReason: "timeout" });
  });

  it("falls back when the AI returns invalid output", async () => {
    process.env.AI_MODE = "live";
    const r = await aiStep({ task: "t", schema: FollowUpSchema, fallback, live: async () => ({ text: "wrong shape" }) });
    expect(r).toMatchObject({ source: "fallback", fallbackReason: "invalid_output" });
  });

  it("falls back when the AI call throws", async () => {
    process.env.AI_MODE = "live";
    const r = await aiStep({
      task: "t",
      schema: FollowUpSchema,
      fallback,
      live: async () => {
        throw new Error("network down");
      },
    });
    expect(r).toMatchObject({ source: "fallback", fallbackReason: "error" });
  });
});

describe("aiStep guards for the free tier", () => {
  it("uses the fallback when no API key is set", async () => {
    process.env.AI_MODE = "live";
    delete process.env.GROQ_API_KEY;
    const r = await aiStep({ task: "t", schema: FollowUpSchema, fallback, live: async () => ({ body: "live" }) });
    expect(r).toMatchObject({ source: "fallback", fallbackReason: "no_api_key" });
  });

  it("pauses live calls after a rate-limit refusal", async () => {
    process.env.AI_MODE = "live";
    const first = await aiStep({
      task: "t",
      schema: FollowUpSchema,
      fallback,
      live: async () => {
        throw new RateLimitError(30_000);
      },
    });
    expect(first.fallbackReason).toBe("rate_limited");
    let called = false;
    const second = await aiStep({
      task: "t",
      schema: FollowUpSchema,
      fallback,
      live: async () => {
        called = true;
        return { body: "live" };
      },
    });
    expect(called).toBe(false);
    expect(second.fallbackReason).toBe("rate_limited");
  });

  it("stops calling the AI after the daily cap", async () => {
    process.env.AI_MODE = "live";
    process.env.AI_DAILY_CALL_LIMIT = "2";
    const call = () => aiStep({ task: "t", schema: FollowUpSchema, fallback, live: async () => ({ body: "Live message." }) });
    expect((await call()).source).toBe("live_ai");
    expect((await call()).source).toBe("live_ai");
    expect(await call()).toMatchObject({ source: "fallback", fallbackReason: "daily_cap" });
  });
});

describe("aiStep validate hook", () => {
  it("rejects live output that fails the extra check", async () => {
    process.env.AI_MODE = "live";
    const r = await aiStep({
      task: "t",
      schema: FollowUpSchema,
      fallback,
      live: async () => ({ body: "She is doing well." }),
      validate: (v) => (/\bshe\b/i.test(v.body) ? "gendered" : null),
    });
    expect(r).toMatchObject({ source: "fallback", fallbackReason: "invalid_output" });
  });
});

describe("out of one model's budget", () => {
  it("answers straight away from the saved response and does not pause other calls", async () => {
    process.env.AI_MODE = "live";
    const first = await aiStep({
      task: "t",
      schema: FollowUpSchema,
      fallback,
      live: async () => {
        throw new BudgetWaitTooLongError(30_000);
      },
    });
    expect(first.fallbackReason).toBe("rate_limited");
    const second = await aiStep({ task: "t", schema: FollowUpSchema, fallback, live: async () => ({ body: "Live message." }) });
    expect(second.source).toBe("live_ai");
  });
});
