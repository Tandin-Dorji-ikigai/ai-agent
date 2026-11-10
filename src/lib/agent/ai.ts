import "server-only";
import type { z } from "zod";
import type { ResultSource } from "../types";
import { RateLimitError, apiKey } from "./llm";

// One AI-dependent step with a guaranteed fallback:
//
//   attempt live AI call -> enforce timeout -> validate output
//     -> on timeout / error / invalid output / rate limit: use the saved fallback
//     -> record source = live_ai | fallback
//
// AI_MODE=fixture (default) makes no AI calls at all.
// AI_MODE=live calls the provider (Groq by default, see llm.ts).

export type AiMode = "fixture" | "live";

export function aiMode(): AiMode {
  return process.env.AI_MODE === "live" ? "live" : "fixture";
}

export type FallbackReason =
  | "fixture_mode"
  | "no_live_implementation"
  | "no_api_key"
  | "daily_cap"
  | "rate_limited"
  | "timeout"
  | "error"
  | "invalid_output";

export interface AiStepResult<T> {
  value: T;
  source: ResultSource;
  /** Why the fallback was used (never contains prompts or keys). */
  fallbackReason?: FallbackReason;
}

// --- Guards that keep the demo fast and inside the free tier --------------

/** After a 429 we skip live calls until the provider says we can retry. */
let cooldownUntil = 0;

/** Simple per-server daily cap on live AI calls (AI_DAILY_CALL_LIMIT, default 300). */
const daily = { day: "", count: 0 };

function takeDailySlot(): boolean {
  const limit = Number(process.env.AI_DAILY_CALL_LIMIT ?? 300);
  const today = new Date().toISOString().slice(0, 10);
  if (daily.day !== today) {
    daily.day = today;
    daily.count = 0;
  }
  if (daily.count >= limit) return false;
  daily.count += 1;
  return true;
}

/** For tests only. */
export function _resetAiGuards() {
  cooldownUntil = 0;
  daily.day = "";
  daily.count = 0;
}

export async function aiStep<S extends z.ZodType>(opts: {
  task: string;
  schema: S;
  fallback: () => z.infer<S>;
  live?: (signal: AbortSignal) => Promise<unknown>;
  /** Extra check on live output; return a reason to reject it (the fallback is used). */
  validate?: (value: z.infer<S>) => string | null;
  timeoutMs?: number;
}): Promise<AiStepResult<z.infer<S>>> {
  const fallbackResult = (reason: FallbackReason) => {
    if (aiMode() === "live" && reason !== "no_live_implementation") {
      console.warn(`[ai] ${opts.task}: using saved response (${reason})`);
    }
    return {
      // Fallbacks are validated too, so a broken fixture fails loudly in tests.
      value: opts.schema.parse(opts.fallback()) as z.infer<S>,
      source: "fallback" as const,
      fallbackReason: reason,
    };
  };

  if (aiMode() !== "live") return fallbackResult("fixture_mode");
  if (!opts.live) return fallbackResult("no_live_implementation");
  if (!apiKey()) return fallbackResult("no_api_key");
  if (Date.now() < cooldownUntil) return fallbackResult("rate_limited");
  if (!takeDailySlot()) return fallbackResult("daily_cap");

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? Number(process.env.AI_TIMEOUT_MS ?? 8000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      opts.live(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("timeout"));
        }, timeoutMs);
      }),
    ]);
    const parsed = opts.schema.safeParse(raw);
    if (!parsed.success) return fallbackResult("invalid_output");
    const rejected = opts.validate?.(parsed.data as z.infer<S>);
    if (rejected) {
      console.warn(`[ai] ${opts.task}: live output rejected (${rejected})`);
      return fallbackResult("invalid_output");
    }
    return { value: parsed.data as z.infer<S>, source: "live_ai" };
  } catch (err) {
    if (err instanceof RateLimitError) {
      cooldownUntil = Date.now() + Math.min(err.retryAfterMs, 60_000);
      return fallbackResult("rate_limited");
    }
    if (err instanceof Error && err.message === "timeout") return fallbackResult("timeout");
    console.warn(`[ai] ${opts.task}: ${err instanceof Error ? err.message.slice(0, 200) : "error"}`);
    return fallbackResult("error");
  } finally {
    if (timer) clearTimeout(timer);
  }
}
