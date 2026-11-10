import "server-only";
import type { z } from "zod";
import { ToolError } from "./agent/tools";
import { CallProviderError } from "./calls/provider";
import { ConfigError, DbError, MigrationsRequiredError } from "./supabase/server";

// Small helpers so every route returns the same JSON error shape:
//   { ok: false, code: "MENTOR_FULLY_BOOKED", message: "..." }

export function ok<T>(data: T, init?: ResponseInit) {
  return Response.json({ ok: true, ...data }, init);
}

export function fail(status: number, code: string, message: string) {
  return Response.json({ ok: false, code, message }, { status });
}

export async function parseBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<{ data: z.infer<S> } | { error: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { error: fail(400, "INVALID_JSON", "Request body must be JSON.") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      error: fail(400, "INVALID_INPUT", first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid input."),
    };
  }
  return { data: parsed.data };
}

const USER_MESSAGES: Record<string, [number, string]> = {
  MENTOR_NOT_BOOKABLE: [409, "This mentor cannot be booked."],
  MENTOR_FULLY_BOOKED: [409, "This mentor is fully booked."],
  BOOKING_ALREADY_ACTIVE: [409, "You already have an active booking with this mentor."],
  NO_ACTIVE_CREDIT: [409, "There is no active YDF credit for this account."],
  INSUFFICIENT_CREDIT: [409, "Not enough YDF credit for this mentor's fee."],
  INVALID_FUNDING_TYPE: [400, "Choose YDF credit or self-payment."],
  ENTREPRENEUR_NOT_FOUND: [404, "Entrepreneur not found."],
  SESSION_NOT_FOUND: [404, "Session not found."],
  ASSESSMENT_REQUIRED: [409, "Complete the needs assessment first."],
  NOT_FOUND: [404, "Not found."],
  INVALID_TRANSITION: [409, "That status change is not allowed."],
  REQUEST_NOT_FOUND: [404, "Request not found."],
  REQUEST_NOT_PENDING: [409, "This request has already been answered or closed."],
  REQUEST_EXPIRED: [409, "This request has expired. The agent has moved on to another mentor."],
  SLOT_NOT_OFFERED: [409, "Pick one of the times offered in the request."],
  SLOT_IN_PAST: [409, "That time has already passed. Pick a later one."],
  NOT_BOOKABLE: [409, "This mentor has no open sessions right now."],
  BOOKING_CANCELLED: [409, "This booking was cancelled."],
  CALL_NOT_AVAILABLE: [409, "Calls are only for confirmed sessions."],
  CALL_NOT_OPEN_YET: [409, "The call is not open yet. It opens shortly before the session."],
  CALL_ENDED: [409, "This call has ended."],
  RECORDING_NOT_ALLOWED: [409, "Recording needs both people to agree first."],
  COACH_NOT_ACTIVE: [409, "The coach is not active. Start it first."],
  STEP_NOT_OPEN: [409, "This step is already done. Refresh to see the next one."],
  STEP_ALREADY_DONE: [409, "This step is already done."],
  COACH_NOT_FINISHED: [409, "All four coach steps must be done first."],
  RATE_LIMITED: [429, "The service is busy. Try again in a minute."],
  TRANSCRIPTION_FAILED: [502, "This part could not be transcribed. Upload it again."],
};

/** Converts thrown errors into safe JSON responses (no stack traces or secrets). */
export function handleError(err: unknown): Response {
  if (err instanceof ConfigError) return fail(503, err.code, err.message);
  if (err instanceof MigrationsRequiredError) {
    console.error("[db] migrations missing:", err.message);
    return fail(
      503,
      err.code,
      "The database is missing tables or columns this version of the app needs. Apply the new migrations (npx supabase db push); for a brand-new, empty project, run supabase/APPLY_ALL.sql instead. The server log has the details.",
    );
  }
  if (err instanceof CallProviderError) return fail(502, "CALL_PROVIDER_FAILED", `${err.message} Try again, or meet another way.`);
  if (err instanceof ToolError) {
    const known = USER_MESSAGES[err.code];
    return fail(known?.[0] ?? 400, err.code, known?.[1] ?? err.message);
  }
  if (err instanceof DbError) {
    const known = err.pgMessage ? USER_MESSAGES[err.pgMessage] : undefined;
    if (known) return fail(known[0], err.pgMessage!, known[1]);
    console.error("[db]", err.message);
    return fail(500, "DATABASE_ERROR", "A database error occurred. Check the server log.");
  }
  console.error("[unexpected]", err);
  return fail(500, "INTERNAL_ERROR", "Something went wrong. Check the server log.");
}
