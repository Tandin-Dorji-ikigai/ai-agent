import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MODELS, RateLimitError, structuredMainOrLight } from "./llm";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const reply = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
const tooMany = (limit: string) =>
  new Response(JSON.stringify({ error: { message: `Rate limit reached for model on tokens per day (${limit}): Limit 200000` } }), { status: 429, headers: { "retry-after": "30" } });

const ask = () =>
  structuredMainOrLight({ task: "test", system: "s", user: "u", schema: z.object({ ok: z.boolean() }), signal: new AbortController().signal });

describe("main model, or the light one when the main one is rate limited", () => {
  it("the light model answers when the main model is out of its daily tokens", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-key");
    const models: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const model = JSON.parse(String(init.body)).model as string;
        models.push(model);
        return model === MODELS.main ? tooMany("TPD") : reply({ ok: true });
      }),
    );
    await expect(ask()).resolves.toEqual({ ok: true });
    expect(models).toEqual([MODELS.main, MODELS.light]);
  });

  it("says which limit was hit when both are rate limited", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => tooMany("TPM")));
    const err = await ask().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).limit).toBe("TPM");
    expect((err as RateLimitError).retryAfterMs).toBe(30_000);
  });
});
