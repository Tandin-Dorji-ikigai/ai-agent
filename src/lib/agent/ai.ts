import "server-only";
import type { z } from "zod";
import type { ResultSource } from "../types";

// One AI-dependent step with a guaranteed fallback:
//
//   attempt live AI call -> enforce timeout -> validate output
//     -> on timeout / error / invalid output: use the saved fallback
//     -> record source = live_ai | fallback
//
// Milestone 1 runs with AI_MODE=fixture (no AI calls at all).
// Milestone 2 adds `live` implementations per step; nothing else changes.

export type AiMode = "fixture" | "live";

export function aiMode(): AiMode {
  return process.env.AI_MODE === "live" ? "live" : "fixture";
}

export interface AiStepResult<T> {
  value: T;
  source: ResultSource;
  /** Why the fallback was used, for the activity log (never contains prompts or keys). */
  fallbackReason?: "fixture_mode" | "no_live_implementation" | "timeout" | "error" | "invalid_output";
}

export async function aiStep<S extends z.ZodType>(opts: {
  task: string;
  schema: S;
  fallback: () => z.infer<S>;
  live?: (signal: AbortSignal) => Promise<unknown>;
  timeoutMs?: number;
}): Promise<AiStepResult<z.infer<S>>> {
  const fallbackResult = (reason: AiStepResult<unknown>["fallbackReason"]) => ({
    // Fallbacks are validated too, so a broken fixture fails loudly in tests.
    value: opts.schema.parse(opts.fallback()) as z.infer<S>,
    source: "fallback" as const,
    fallbackReason: reason,
  });

  if (aiMode() !== "live") return fallbackResult("fixture_mode");
  if (!opts.live) return fallbackResult("no_live_implementation");

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
    return { value: parsed.data as z.infer<S>, source: "live_ai" };
  } catch (err) {
    return fallbackResult(err instanceof Error && err.message === "timeout" ? "timeout" : "error");
  } finally {
    if (timer) clearTimeout(timer);
  }
}
