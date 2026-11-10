import { z } from "zod";
import { aiMode } from "@/lib/agent/ai";
import { extractFromText } from "@/lib/agent/extract";
import { MAX_TRANSCRIPT_CHARS, NOTES_SOURCES } from "@/lib/agent/schemas";
import { fail, handleError, ok, parseBody } from "@/lib/http";

// DEV ONLY: runs the agent's extraction on any text WITHOUT saving anything.
// Used by `npm run eval:extraction`. Disabled in production builds unless
// ENABLE_DEV_ROUTES=1.

const Body = z.object({
  text: z.string().trim().min(1).max(MAX_TRANSCRIPT_CHARS + 4100),
  source: z.enum(NOTES_SOURCES).default("call_recording"),
});

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEV_ROUTES !== "1") {
    return fail(404, "NOT_FOUND", "Not found.");
  }
  const body = await parseBody(req, Body);
  if ("error" in body) return body.error;
  try {
    const started = Date.now();
    const out = await extractFromText(body.data.text, body.data.source);
    return ok({ ...out, ai_mode: aiMode(), ms: Date.now() - started });
  } catch (err) {
    return handleError(err);
  }
}
