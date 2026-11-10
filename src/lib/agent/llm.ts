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
  transcribe: process.env.AI_MODEL_TRANSCRIBE ?? "whisper-large-v3-turbo",
};

export function apiKey(): string | undefined {
  return process.env.GROQ_API_KEY || process.env.AI_API_KEY || undefined;
}

export class RateLimitError extends Error {
  constructor(public retryAfterMs: number) {
    super("rate_limited");
  }
}

export class ProviderError extends Error {}

async function post(path: string, body: BodyInit, signal: AbortSignal, json = true): Promise<Record<string, unknown>> {
  const key = apiKey();
  if (!key) throw new ProviderError("No AI API key configured.");
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, ...(json ? { "Content-Type": "application/json" } : {}) },
    body,
    signal,
  });
  if (res.status === 429) {
    const retry = Number(res.headers.get("retry-after") ?? "20");
    throw new RateLimitError((Number.isFinite(retry) ? retry : 20) * 1000);
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
}): Promise<unknown> {
  const model = opts.model ?? MODELS.main;
  const messages: Message[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];
  const data = await post(
    "/chat/completions",
    JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      reasoning_effort: "low",
      max_completion_tokens: opts.maxTokens ?? 1200,
      response_format: {
        type: "json_schema",
        json_schema: { name: opts.task, strict: true, schema: toStrictJsonSchema(opts.schema) },
      },
    }),
    opts.signal,
  );
  logUsage(opts.task, model, data);
  const content = (data.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content;
  if (!content) throw new ProviderError("Empty response.");
  return stripNulls(JSON.parse(content));
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
  const data = await post(
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
  logUsage(opts.task, model, data);
  const call = (data.choices as Array<{ message?: { tool_calls?: Array<{ function: { name: string; arguments: string } }> } }> | undefined)?.[0]
    ?.message?.tool_calls?.[0];
  if (!call) throw new ProviderError("The model did not call a tool.");
  return { name: call.function.name, args: JSON.parse(call.function.arguments || "{}") };
}

/** Speech-to-text (Whisper). */
export async function transcribe(file: Blob, filename: string, signal: AbortSignal): Promise<string> {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("model", MODELS.transcribe);
  form.append("response_format", "json");
  const data = await post("/audio/transcriptions", form, signal, false);
  console.info(`[ai] transcribe via ${MODELS.transcribe}: ${Math.round(file.size / 1024)} KB`);
  return String(data.text ?? "").trim();
}
