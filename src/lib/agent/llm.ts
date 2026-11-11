import "server-only";
import type { z } from "zod";
import { stripNulls, toStrictJsonSchema } from "./json-schema";

// Minimal client for an OpenAI-compatible API. Default: Groq (free tier).
// Switching provider = change AI_BASE_URL and the key; nothing else.
//
// Only plain HTTP; the API key never leaves the server and is never logged.

const BASE_URL = process.env.AI_BASE_URL ?? "https://api.groq.com/openai/v1";

export const MODELS = {
  /** Harder steps: explanations, briefs, extraction, decisions. */
  main: process.env.AI_MODEL ?? "openai/gpt-oss-120b",
  /** Light steps: summaries, check-in messages, reading replies. Separate per-model rate limit. */
  light: process.env.AI_MODEL_LIGHT ?? "openai/gpt-oss-20b",
};

/** The agent's key: every AI text step (summaries, matching, briefs, extraction, decisions). */
export function apiKey(): string | undefined {
  return process.env.GROQ_API_KEY || process.env.AI_API_KEY || undefined;
}

/**
 * The speech-to-text key: voice notes, voice intros, call and video recordings.
 * Groq counts rate limits per account, so a key from a SEPARATE Groq account
 * gives transcription its own limits. Falls back to the agent's key.
 */
export function transcribeApiKey(): string | undefined {
  return process.env.GROQ_TRANSCRIBE_API_KEY || apiKey();
}

/** Which key transcription uses, for logs (never the key itself). */
export function transcribeKeyName(): "transcription key" | "agent key" {
  return process.env.GROQ_TRANSCRIBE_API_KEY ? "transcription key" : "agent key";
}

export class RateLimitError extends Error {
  /** Which provider limit was hit, e.g. TPM (tokens per minute) or TPD (tokens per day). */
  constructor(
    public retryAfterMs: number,
    public limit = "unknown",
  ) {
    super("rate_limited");
  }
}

export class ProviderError extends Error {}

/** The model's per-minute budget would need a longer wait than this step allows. */
export class BudgetWaitTooLongError extends Error {
  constructor(public waitMs: number) {
    super("budget_wait_too_long");
  }
}

/** Interactive steps should answer fast: wait at most this long for budget, then use the saved answer. */
export const INTERACTIVE_MAX_WAIT_MS = 7_000;
/** Background work (long transcripts) can afford to wait for budget. */
export const BACKGROUND_MAX_WAIT_MS = 65_000;

// ---------------------------------------------------------------------------
// Free-tier pacing: tokens per minute, tracked per model (AI_TPM_LIMIT, default
// 8,000). Before each call we wait, if needed, until the last minute's usage
// leaves room. This avoids 429s instead of reacting to them.
// ---------------------------------------------------------------------------

const WINDOW_MS = 60_000;
const HEADROOM = 0.85;

export interface UsageEntry {
  at: number;
  tokens: number;
}

const recentUsage = new Map<string, UsageEntry[]>();

export function tpmLimit(): number {
  return Number(process.env.AI_TPM_LIMIT ?? 8000);
}

/** Pure: milliseconds to wait before spending `estimate` tokens (0 = go now). */
export function budgetWaitMs(entries: UsageEntry[], now: number, estimate: number, limit: number): number {
  const live = entries.filter((e) => now - e.at < WINDOW_MS).sort((a, b) => a.at - b.at);
  const used = live.reduce((sum, e) => sum + e.tokens, 0);
  const allowed = limit * HEADROOM;
  if (live.length === 0 || used + estimate <= allowed) return 0;
  let excess = used + estimate - allowed;
  for (const e of live) {
    excess -= e.tokens;
    if (excess <= 0) return Math.max(0, e.at + WINDOW_MS - now) + 50;
  }
  return WINDOW_MS;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    }, { once: true });
  });
}

async function reserveTokens(model: string, estimate: number, signal: AbortSignal, maxWaitMs: number): Promise<UsageEntry> {
  const started = Date.now();
  for (;;) {
    const entries = (recentUsage.get(model) ?? []).filter((e) => Date.now() - e.at < WINDOW_MS);
    recentUsage.set(model, entries);
    const wait = budgetWaitMs(entries, Date.now(), estimate, tpmLimit());
    if (wait > 0 && Date.now() - started + wait > maxWaitMs) throw new BudgetWaitTooLongError(wait);
    if (wait === 0) {
      const entry = { at: Date.now(), tokens: estimate };
      entries.push(entry);
      return entry;
    }
    await sleep(Math.min(wait, 5_000), signal);
  }
}

function settleUsage(entry: UsageEntry, data: Record<string, unknown>) {
  const u = data.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
  if (u?.prompt_tokens !== undefined) entry.tokens = (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0);
}

const approxTokens = (s: string) => Math.ceil(s.length / 4);

/** Low-level POST to the provider. Shared by the agent (here) and audio (src/lib/audio, which passes its own key). */
export async function providerPost(
  path: string,
  body: BodyInit,
  signal: AbortSignal,
  json = true,
  key: string | undefined = apiKey(),
): Promise<Record<string, unknown>> {
  if (!key) throw new ProviderError("No AI API key configured.");
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, ...(json ? { "Content-Type": "application/json" } : {}) },
    body,
    signal,
  });
  if (res.status === 429) {
    const retry = Number(res.headers.get("retry-after") ?? "20");
    // Only the limit's short name is kept (the message also names the account).
    const limit = (await res.text().catch(() => "")).match(/\((TPM|TPD|RPM|RPD|ASH|ASD)\)/)?.[1];
    throw new RateLimitError((Number.isFinite(retry) ? retry : 20) * 1000, limit);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (data.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`;
    throw new ProviderError(`${res.status}: ${msg.slice(0, 200)}`);
  }
  return data;
}

function logUsage(task: string, model: string, data: Record<string, unknown>) {
  const u = data.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
  console.info(`[ai] ${task} via ${model}: ${u?.prompt_tokens ?? "?"} in / ${u?.completion_tokens ?? "?"} out tokens`);
}

interface Message {
  role: "system" | "user";
  content: string;
}

/** A fixed-format (strict JSON schema) answer. Returns parsed JSON; the caller validates with zod. */
export async function structured(opts: {
  task: string;
  model?: string;
  system: string;
  user: string;
  schema: z.ZodType;
  maxTokens?: number;
  signal: AbortSignal;
  /** How long to wait for the per-minute budget (default: interactive). */
  maxWaitMs?: number;
}): Promise<unknown> {
  const model = opts.model ?? MODELS.main;
  const messages: Message[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];
  const strictSchema = toStrictJsonSchema(opts.schema);
  const usage = await reserveTokens(
    model,
    approxTokens(opts.system + opts.user + JSON.stringify(strictSchema)) + Math.round((opts.maxTokens ?? 1200) / 3),
    opts.signal,
    opts.maxWaitMs ?? INTERACTIVE_MAX_WAIT_MS,
  );
  const data = await providerPost(
    "/chat/completions",
    JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      reasoning_effort: "low",
      max_completion_tokens: opts.maxTokens ?? 1200,
      response_format: {
        type: "json_schema",
        json_schema: { name: opts.task, strict: true, schema: strictSchema },
      },
    }),
    opts.signal,
  );
  settleUsage(usage, data);
  logUsage(opts.task, model, data);
  const content = (data.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content;
  if (!content) throw new ProviderError("Empty response.");
  return stripNulls(JSON.parse(content));
}

/**
 * The main model, or the light model (it has its own rate limits) when the main
 * one is rate limited or out of this minute's budget. For steps where the
 * rule-based fallback is much weaker than either model.
 */
export async function structuredMainOrLight(opts: Omit<Parameters<typeof structured>[0], "model">): Promise<unknown> {
  try {
    return await structured({ ...opts, model: MODELS.main });
  } catch (err) {
    const busy = err instanceof RateLimitError || err instanceof BudgetWaitTooLongError;
    if (!busy || MODELS.light === MODELS.main || opts.signal.aborted) throw err;
    console.warn(`[ai] ${opts.task}: ${MODELS.main} is busy (${err instanceof RateLimitError ? err.limit : "minute budget"}); trying ${MODELS.light}`);
    return structured({ ...opts, model: MODELS.light });
  }
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Real tool calling: the model must pick exactly one tool. Our code then validates and runs it. */
export async function chooseTool(opts: {
  task: string;
  model?: string;
  system: string;
  user: string;
  tools: ToolSpec[];
  signal: AbortSignal;
}): Promise<{ name: string; args: unknown }> {
  const model = opts.model ?? MODELS.main;
  const usage = await reserveTokens(
    model,
    approxTokens(opts.system + opts.user + JSON.stringify(opts.tools)) + 300,
    opts.signal,
    INTERACTIVE_MAX_WAIT_MS,
  );
  const data = await providerPost(
    "/chat/completions",
    JSON.stringify({
      model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      temperature: 0.2,
      reasoning_effort: "low",
      max_completion_tokens: 900,
      tools: opts.tools.map((t) => ({ type: "function", function: t })),
      tool_choice: "required",
      parallel_tool_calls: false,
    }),
    opts.signal,
  );
  settleUsage(usage, data);
  logUsage(opts.task, model, data);
  const call = (data.choices as Array<{ message?: { tool_calls?: Array<{ function: { name: string; arguments: string } }> } }> | undefined)?.[0]
    ?.message?.tool_calls?.[0];
  if (!call) throw new ProviderError("The model did not call a tool.");
  return { name: call.function.name, args: JSON.parse(call.function.arguments || "{}") };
}
