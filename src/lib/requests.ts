import "server-only";
import { coachComesFirst } from "./agent/coach";
import { emitAndRun, type RunOutcome } from "./agent/runner";
import { ToolError } from "./agent/tools";
import { demoNow } from "./clock";
import { loadEntrepreneur } from "./data";
import { db, must } from "./supabase/server";
import type { DeclineReason, MentorRequestRecord } from "./types";

// What PEOPLE do with a mentor request. The agent sends requests (see
// send_mentor_request); only the mentor can accept or decline one.
// ensureMentorRequest keeps the agent going without anyone pressing a button.

async function loadRequest(id: string): Promise<MentorRequestRecord> {
  const req = must(
    await db().from("mentor_requests").select("*").eq("id", id).maybeSingle(),
    "load request",
  ) as MentorRequestRecord | null;
  if (!req) throw new ToolError("REQUEST_NOT_FOUND", "Request not found.");
  return req;
}

/**
 * The mentor says yes and picks one of the offered times. The booking, the
 * credit deduction and the request update happen in one transaction
 * (accept_mentor_request). Then the agent prepares both briefs.
 */
export async function acceptRequest(requestId: string, scheduledAt: string): Promise<{ booking_id: string; outcome: RunOutcome }> {
  const res = await db().rpc("accept_mentor_request", { p_request_id: requestId, p_scheduled_at: scheduledAt });
  if (res.error) {
    const code = /^[A-Z_]+$/.test(res.error.message) ? res.error.message : "ACCEPT_FAILED";
    // Too late: close it now so the agent moves on to the next mentor.
    if (code === "REQUEST_EXPIRED") await expireDueRequests(await demoNow());
    throw new ToolError(code, res.error.message);
  }
  const out = res.data as { request_id: string; booking_id: string };
  const req = await loadRequest(requestId);
  const outcome = await emitAndRun({
    event_type: "booking.confirmed",
    entity_type: "booking",
    entity_id: out.booking_id,
    entrepreneur_id: req.entrepreneur_id,
    dedupe_key: `booking.confirmed:${out.booking_id}`,
  });
  return { booking_id: out.booking_id, outcome };
}

/** The mentor says no. The agent then asks the next best mentor (or YDF). */
export async function declineRequest(
  requestId: string,
  reason: DeclineReason,
  note: string | undefined,
  now: Date,
): Promise<{ outcome: RunOutcome }> {
  const req = await loadRequest(requestId);
  if (req.status === "declined") {
    // A repeat (double click): the agent has already acted on it.
    const outcome = await emitAndRun(closedEvent(req, "mentor.request.declined"));
    return { outcome };
  }
  if (req.status !== "pending") throw new ToolError("REQUEST_NOT_PENDING", "This request is no longer open.");
  const updated = must(
    await db()
      .from("mentor_requests")
      .update({ status: "declined", decline_reason: reason, decline_note: note || null, responded_at: now.toISOString() })
      .eq("id", requestId)
      .eq("status", "pending")
      .select("id"),
    "decline request",
  ) as Array<{ id: string }>;
  if (updated.length === 0) throw new ToolError("REQUEST_NOT_PENDING", "This request is no longer open.");
  return { outcome: await emitAndRun(closedEvent(req, "mentor.request.declined")) };
}

/** Requests with no reply by their deadline expire, and the agent moves on. */
export async function expireDueRequests(now: Date): Promise<RunOutcome[]> {
  const expired = must(
    await db()
      .from("mentor_requests")
      .update({ status: "expired", responded_at: now.toISOString() })
      .eq("status", "pending")
      .lte("expires_at", now.toISOString())
      .select("*"),
    "expire requests",
  ) as MentorRequestRecord[];
  const outcomes: RunOutcome[] = [];
  for (const req of expired) outcomes.push(await emitAndRun(closedEvent(req, "mentor.request.expired")));
  return outcomes;
}

/**
 * The agent's next step after a "no" (or no reply). Keyed by the request, so it
 * runs once however many places trigger it: the decline itself, expiry, or
 * ensureMentorRequest picking up an unfinished step.
 */
function closedEvent(req: Pick<MentorRequestRecord, "id" | "entrepreneur_id">, type: "mentor.request.declined" | "mentor.request.expired") {
  return {
    event_type: type,
    entity_type: "mentor_request",
    entity_id: req.id,
    entrepreneur_id: req.entrepreneur_id,
    dedupe_key: `${type}:${req.id}`,
  } as const;
}

export type EnsureReason = "asked" | "retried" | "already_asked" | "in_progress" | "booked" | "with_ydf" | "coach_first";

/** Agent events that move a mentor request along. */
const REQUEST_EVENTS = ["mentor.match.requested", "mentor.selected", "mentor.request.declined", "mentor.request.expired"];
/** A run older than this that never finished is treated as crashed, not in progress. */
const IN_PROGRESS_MS = 2 * 60_000;

/**
 * Makes sure the agent is working on finding the mentee a mentor, with no
 * button: if they have matches but nobody has been asked (or the agent's last
 * step failed), the agent asks now. Safe to call repeatedly: it does nothing
 * when a mentor is already deciding, a session is booked, YDF is handling it,
 * or the agent is busy right now.
 */
export async function ensureMentorRequest(entrepreneurId: string): Promise<{ started: boolean; reason: EnsureReason; outcome?: RunOutcome }> {
  const e = await loadEntrepreneur(entrepreneurId);
  if (!e?.assessment_completed_at) throw new ToolError("ASSESSMENT_REQUIRED", "Needs assessment not completed.");
  if (await coachComesFirst(e)) return { started: false, reason: "coach_first" };
  const now = await demoNow();

  const [requests, bookings, escalations, busy] = await Promise.all([
    db().from("mentor_requests").select("id, round_id, status, created_at").eq("entrepreneur_id", entrepreneurId).order("created_at", { ascending: false }),
    db().from("bookings").select("id").eq("entrepreneur_id", entrepreneurId).limit(1),
    db()
      .from("escalations")
      .select("created_at")
      .eq("entrepreneur_id", entrepreneurId)
      .eq("reason", "no_mentor_available")
      .neq("status", "resolved")
      .order("created_at", { ascending: false })
      .limit(1),
    db()
      .from("agent_events")
      .select("id")
      .eq("entrepreneur_id", entrepreneurId)
      .in("event_type", REQUEST_EVENTS)
      .in("status", ["pending", "processing"])
      .gte("created_at", new Date(now.getTime() - IN_PROGRESS_MS).toISOString())
      .limit(1),
  ]);
  const reqs = must(requests, "load requests") as Array<{ id: string; round_id: string; status: string; created_at: string }>;
  // After a first session, further sessions are the mentee's choice (a follow-up request).
  if ((must(bookings, "load bookings") as unknown[]).length > 0) return { started: false, reason: "booked" };
  if ((must(busy, "load running events") as unknown[]).length > 0) return { started: false, reason: "in_progress" };

  const latest = reqs[0];
  if (latest?.status === "pending") return { started: false, reason: "already_asked" };

  const roundStart = latest
    ? Date.parse(reqs.filter((r) => r.round_id === latest.round_id).at(-1)!.created_at)
    : Date.parse(e.assessment_completed_at);
  const escalation = (must(escalations, "load escalations") as Array<{ created_at: string }>)[0];
  if (escalation && Date.parse(escalation.created_at) >= roundStart) return { started: false, reason: "with_ydf" };

  // The last mentor said no (or did not reply) and nobody new is being asked:
  // run the agent's next step for that request. It is the same keyed event the
  // decline creates, so it can never run twice, even if both happen at once.
  if (latest && (latest.status === "declined" || latest.status === "expired")) {
    const type = latest.status === "declined" ? "mentor.request.declined" : "mentor.request.expired";
    const outcome = await emitAndRun(closedEvent({ id: latest.id, entrepreneur_id: entrepreneurId }, type));
    return { started: outcome.status !== "skipped", reason: "retried", outcome };
  }

  // Nobody is being asked: matching runs again and the agent asks the best match.
  const outcome = await emitAndRun({
    event_type: "mentor.match.requested",
    entity_type: "entrepreneur",
    entity_id: entrepreneurId,
    entrepreneur_id: entrepreneurId,
    dedupe_key: `mentor.request.auto:${e.assessment_completed_at}:${latest?.id ?? "none"}`,
  });
  return { started: outcome.status !== "skipped", reason: "asked", outcome };
}
