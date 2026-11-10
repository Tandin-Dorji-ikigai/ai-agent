import { afterEach, describe, expect, it } from "vitest";
import { aiStep } from "./ai";
import { FollowUpSchema } from "./schemas";

const fallback = () => ({ body: "Saved fallback message." });

afterEach(() => {
  delete process.env.AI_MODE;
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
