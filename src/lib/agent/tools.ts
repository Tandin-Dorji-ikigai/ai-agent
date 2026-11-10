import "server-only";
import type { z } from "zod";
import { loadActionItem, loadEntrepreneur, loadMentor, loadMentors } from "../data";
import { fundingFor, isBookable, menteeSummary, REQUEST_TTL_HOURS } from "../matching/requests";
import { isEligible, scoreMentor, topMatches } from "../matching/score-mentor";
import { upcomingSlots } from "../matching/slots";
import { db, DbError, must } from "../supabase/server";
import type { ActionItemRecord, ActionStatus, MentorRequestRecord, ResourceRecord } from "../types";
import { extractFromText } from "./extract";
import { ToolInputs, type ToolName } from "./schemas";

// The agent's controlled tools (CLAUDE_WORKING_PLAN.md, "Agent tools").
// Rules enforced here, not in prompts:
// - every input is validated with a schema;
// - each event type may only use its allowed tools (see ALLOWED_TOOLS);
// - tools only touch the entities they are given and check ownership;
// - nothing here approves credit, funding, payments or mentors;
// - the agent can ASK a mentor, but only the mentor can accept (and only
//   then is anything booked or any credit used).

export class ToolError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ToolEnv {
  now: Date;
}

export interface ToolCallRecord {
  tool: ToolName;
  input: Record<string, unknown>;
  ok: boolean;
  summary: string;
}

const iso = (d: Date) => d.toISOString();

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

type In<N extends ToolName> = z.infer<(typeof ToolInputs)[N]>;

async function get_entrepreneur_context(input: In<"get_entrepreneur_context">) {
  const profile = await loadEntrepreneur(input.entrepreneur_id);
  if (!profile) throw new ToolError("NOT_FOUND", "Entrepreneur not found.");

  const open_actions = must(
    await db()
      .from("action_items")
      .select("*")
      .eq("entrepreneur_id", input.entrepreneur_id)
      .in("status", ["pending", "overdue", "blocked"])
      .order("due_at"),
    "load open actions",
  ) as ActionItemRecord[];

  const credit = must(
    await db()
      .from("sponsorship_credits")
      .select("amount_granted, amount_remaining, status")
      .eq("entrepreneur_id", input.entrepreneur_id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
    "load credit",
  ) as { amount_granted: number; amount_remaining: number; status: string } | null;

  const recent_sessions = must(
    await db()
      .from("sessions")
      .select("id, agent_summary, completed_at, bookings!inner(entrepreneur_id, mentor_id)")
      .eq("bookings.entrepreneur_id", input.entrepreneur_id)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(3),
    "load sessions",
  ) as Array<{ id: string; agent_summary: string | null; completed_at: string }>;

  return {
    result: { profile, open_actions, credit, recent_sessions },
    summary: `${profile.full_name}: ${open_actions.length} open actions, ${recent_sessions.length} past sessions.`,
  };
}

async function find_matching_mentors(input: In<"find_matching_mentors">) {
  const e = await loadEntrepreneur(input.entrepreneur_id);
  if (!e) throw new ToolError("NOT_FOUND", "Entrepreneur not found.");
  if (!e.assessment_completed_at) throw new ToolError("ASSESSMENT_REQUIRED", "Needs assessment not completed.");
  const ranked = topMatches(e, await loadMentors(), input.limit);
  return {
    result: ranked,
    summary: ranked.map((r) => `${r.mentor.full_name} (${r.score})`).join(", ") || "No eligible mentors.",
  };
}

/**
 * Sends a mentoring request to one mentor. The mentor decides: nothing is
 * booked and no credit is used until they accept and pick a time.
 */
async function send_mentor_request(input: In<"send_mentor_request">, env: ToolEnv) {
  const [entrepreneur, mentor] = await Promise.all([loadEntrepreneur(input.entrepreneur_id), loadMentor(input.mentor_id)]);
  if (!entrepreneur) throw new ToolError("NOT_FOUND", "Entrepreneur not found.");
  if (!mentor || !isBookable(mentor)) throw new ToolError("NOT_BOOKABLE", "Mentor is not verified, active and available.");

  // Idempotent: the same mentor in the same round is asked once.
  const existing = must(
    await db().from("mentor_requests").select("*").eq("round_id", input.round_id).eq("mentor_id", input.mentor_id).maybeSingle(),
    "load request",
  ) as MentorRequestRecord | null;
  if (existing) return { result: { request: existing, mentor }, summary: `${mentor.full_name} was already asked in this round.` };

  const offered = upcomingSlots(mentor.weekly_slots, env.now);
  if (offered.length === 0) throw new ToolError("NO_TIMES", "Mentor has no upcoming times.");

  const [credit, previous] = await Promise.all([
    db()
      .from("sponsorship_credits")
      .select("amount_remaining, status")
      .eq("entrepreneur_id", input.entrepreneur_id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
    db()
      .from("bookings")
      .select("id")
      .eq("entrepreneur_id", input.entrepreneur_id)
      .eq("mentor_id", input.mentor_id)
      .eq("status", "completed")
      .limit(1),
  ]);
  const activeCredit = must(credit, "load credit") as { amount_remaining: number; status: string } | null;
  const followUp = (must(previous, "load previous sessions") as Array<{ id: string }>).length > 0;
  const scored = scoreMentor(entrepreneur, mentor);

  const res = await db()
    .from("mentor_requests")
    .insert({
      entrepreneur_id: input.entrepreneur_id,
      mentor_id: mentor.id,
      round_id: input.round_id,
      attempt: input.attempt,
      kind: input.kind,
      score: scored.score,
      funding_type: fundingFor(activeCredit ? { ...activeCredit, amount_remaining: Number(activeCredit.amount_remaining) } : null, mentor.fee),
      fee: mentor.fee,
      mentee_summary: menteeSummary(entrepreneur, scored, followUp),
      offered_slots: offered,
      status: "pending",
      expires_at: iso(new Date(env.now.getTime() + REQUEST_TTL_HOURS * 3_600_000)),
      created_at: iso(env.now),
    })
    .select("*")
    .single();
  if (res.error?.code === "23505") throw new ToolError("REQUEST_OPEN", "This mentee already has an open mentor request.");
  const request = must(res, "send request") as MentorRequestRecord;
  return {
    result: { request, mentor },
    summary: `Asked ${mentor.full_name} (request ${input.attempt}), offering ${offered.length} times; reply due in ${REQUEST_TTL_HOURS} hours.`,
  };
}

async function create_session_brief(input: In<"create_session_brief">) {
  const booking = must(
    await db().from("bookings").select("*").eq("id", input.booking_id).maybeSingle(),
    "load booking",
  ) as { id: string; entrepreneur_id: string; mentor_id: string; scheduled_at: string; fee: number; idempotency_key: string } | null;
  if (!booking) throw new ToolError("NOT_FOUND", "Booking not found.");
  const [entrepreneur, mentor] = await Promise.all([loadEntrepreneur(booking.entrepreneur_id), loadMentor(booking.mentor_id)]);
  if (!entrepreneur || !mentor) throw new ToolError("NOT_FOUND", "Booking participants not found.");
  return {
    result: { booking, entrepreneur, mentor },
    summary: `Brief source data for ${entrepreneur.full_name} and ${mentor.full_name}.`,
  };
}

async function extract_action_items(input: In<"extract_action_items">, env: ToolEnv) {
  const session = must(
    await db().from("sessions").select("id, bookings!inner(entrepreneur_id)").eq("id", input.session_id).maybeSingle(),
    "load session",
  ) as { id: string; bookings: { entrepreneur_id: string } } | null;
  if (!session) throw new ToolError("NOT_FOUND", "Session not found.");

  // Idempotent: never extract twice for the same session.
  const existing = must(
    await db().from("action_items").select("*").eq("session_id", input.session_id).order("due_in_days"),
    "load existing actions",
  ) as ActionItemRecord[];
  if (existing.length > 0) {
    return {
      result: { summary: null as string | null, actions: existing, source: "fallback" as const, reused: true, parts: 0, liveParts: 0 },
      summary: `Reused ${existing.length} existing actions.`,
    };
  }

  // Short text: one pass. Long call transcripts: split, read each part, combine.
  // Today (demo clock) turns "by Friday" into days.
  const out = await extractFromText(input.notes, input.source, env.now);
  const step = { value: out.extraction, source: out.source };

  const rows = step.value.actions.map((a) => ({
    session_id: input.session_id,
    entrepreneur_id: session.bookings.entrepreneur_id,
    title: a.title,
    description: a.description ?? null,
    success_measure: a.success_measure ?? null,
    owner: a.owner,
    due_in_days: a.due_in_days,
    status: "draft",
    created_at: iso(env.now),
    updated_at: iso(env.now),
  }));
  const inserted =
    rows.length > 0 ? (must(await db().from("action_items").insert(rows).select("*"), "insert draft actions") as ActionItemRecord[]) : [];

  must(
    await db()
      .from("sessions")
      .update({ agent_summary: step.value.summary, summary_source: step.source })
      .eq("id", input.session_id)
      .select("id"),
    "save session summary",
  );

  return {
    result: { summary: step.value.summary, actions: inserted, source: step.source, reused: false, parts: out.parts, liveParts: out.liveParts },
    summary:
      `${inserted.length} draft actions extracted (${step.source})` +
      (out.parts > 1 ? ` from ${out.parts} transcript parts (${out.liveParts} read by live AI)` : "") +
      "; waiting for human confirmation.",
  };
}

const ALLOWED_TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  draft: [], // drafts only become pending through human confirmation
  pending: ["completed", "blocked", "overdue"],
  overdue: ["completed", "blocked"],
  blocked: ["completed", "pending", "blocked"],
  completed: [],
};

async function update_action_status(input: In<"update_action_status">, env: ToolEnv) {
  const action = await loadActionItem(input.action_id);
  if (!action || action.entrepreneur_id !== input.entrepreneur_id) {
    throw new ToolError("NOT_FOUND", "Action not found for this entrepreneur.");
  }
  if (!ALLOWED_TRANSITIONS[action.status].includes(input.status)) {
    if (action.status === input.status) {
      return { result: action, summary: `"${action.title}" already ${action.status}.` };
    }
    throw new ToolError("INVALID_TRANSITION", `Cannot change an action from ${action.status} to ${input.status}.`);
  }
  const updated = must(
    await db()
      .from("action_items")
      .update({
        status: input.status,
        blocker: input.status === "blocked" ? (input.blocker ?? action.blocker) : action.blocker,
        updated_at: iso(env.now),
      })
      .eq("id", action.id)
      .eq("status", action.status)
      .select("*")
      .maybeSingle(),
    "update action status",
  ) as ActionItemRecord | null;
  if (!updated) throw new ToolError("CONFLICT", "Action changed at the same time; try again.");
  return { result: updated, summary: `"${updated.title}": ${action.status} -> ${updated.status}.` };
}

async function recommend_approved_resource(input: In<"recommend_approved_resource">) {
  const resource = must(
    await db().from("resources").select("*").eq("id", input.resource_id).maybeSingle(),
    "load resource",
  ) as ResourceRecord | null;
  if (!resource) throw new ToolError("NOT_FOUND", "Resource not found.");
  if (!resource.approved) throw new ToolError("NOT_APPROVED", "Only approved resources can be recommended.");
  return { result: resource, summary: `Recommended "${resource.title}".` };
}

async function suggest_mentor_session(input: In<"suggest_mentor_session">) {
  const mentor = await loadMentor(input.mentor_id);
  if (!mentor || !isEligible(mentor)) throw new ToolError("NOT_ELIGIBLE", "Mentor is not verified and active.");
  if (mentor.slots_remaining < 1) throw new ToolError("FULLY_BOOKED", "Mentor has no open sessions.");
  // A suggestion only. Nothing is booked until the entrepreneur confirms.
  return { result: mentor, summary: `Suggested a session with ${mentor.full_name} (not booked).` };
}

async function create_escalation(input: In<"create_escalation">, env: ToolEnv) {
  const res = await db()
    .from("escalations")
    .insert({
      entrepreneur_id: input.entrepreneur_id,
      action_item_id: input.action_item_id ?? null,
      session_id: input.session_id ?? null,
      reason: input.reason,
      summary: input.summary,
      priority: input.priority,
      status: "open", // the agent can never assign or resolve
      created_at: iso(env.now),
    })
    .select("*")
    .single();
  if (res.error?.code === "23505" && input.action_item_id) {
    // Already escalated: return the open one instead of creating a duplicate.
    const existing = must(
      await db()
        .from("escalations")
        .select("*")
        .eq("action_item_id", input.action_item_id)
        .neq("status", "resolved")
        .single(),
      "load existing escalation",
    ) as { id: string; code: string };
    return { result: existing, summary: `Escalation ${existing.code} already open.` };
  }
  const escalation = must(res, "create escalation") as { id: string; code: string };
  return { result: escalation, summary: `Created escalation ${escalation.code}.` };
}

async function send_inbox_message(input: In<"send_inbox_message">, env: ToolEnv) {
  const row = must(
    await db()
      .from("messages")
      .insert({
        entrepreneur_id: input.entrepreneur_id,
        sender: "agent",
        kind: input.kind,
        body: input.body,
        body_dz: input.body_dz ?? null,
        dz_verified: input.dz_verified ?? false,
        related_action_id: input.related_action_id ?? null,
        awaiting_reply: input.awaiting_reply ?? false,
        metadata: input.metadata ?? {},
        source: input.source,
        created_at: iso(env.now),
      })
      .select("id")
      .single(),
    "send message",
  ) as { id: string };
  return { result: row, summary: `Sent ${input.kind} message.` };
}

async function loadOwnedAction(entrepreneurId: string, actionId: string): Promise<ActionItemRecord> {
  const action = await loadActionItem(actionId);
  if (!action || action.entrepreneur_id !== entrepreneurId) {
    throw new ToolError("NOT_FOUND", "Action not found for this entrepreneur.");
  }
  return action;
}

/** "Add to mentor progress": one entry in the mentor's progress feed. */
async function record_progress(input: In<"record_progress">, env: ToolEnv) {
  const action = await loadOwnedAction(input.entrepreneur_id, input.action_id);
  const row = must(
    await db()
      .from("progress_updates")
      .insert({
        entrepreneur_id: input.entrepreneur_id,
        action_item_id: action.id,
        kind: input.kind,
        note: input.note ?? null,
        agenda: input.agenda,
        source: input.source,
        created_at: iso(env.now),
      })
      .select("id")
      .single(),
    "record progress",
  ) as { id: string };
  return { result: row, summary: `Progress on "${action.title}": ${input.kind.replaceAll("_", " ")}${input.agenda ? " (on next agenda)" : ""}.` };
}

/** "Confirm next check-in": the scheduling agent will ask again on this date. */
async function schedule_check_in(input: In<"schedule_check_in">, env: ToolEnv) {
  const action = await loadOwnedAction(input.entrepreneur_id, input.action_id);
  if (!["pending", "overdue", "blocked"].includes(action.status)) {
    throw new ToolError("INVALID_TRANSITION", `No check-in needed for a ${action.status} action.`);
  }
  const at = new Date(env.now.getTime() + input.in_days * 86_400_000);
  must(
    await db().from("action_items").update({ next_check_in_at: iso(at), updated_at: iso(env.now) }).eq("id", action.id).select("id"),
    "schedule check-in",
  );
  return { result: { action_id: action.id, at: iso(at) }, summary: `Next check-in on "${action.title}" in ${input.in_days} day(s).` };
}

/**
 * "Request to human mentor": only the mentee's own mentor (someone they have
 * booked), verified and active. Lands on the next session's agenda.
 */
async function request_mentor_help(input: In<"request_mentor_help">, env: ToolEnv) {
  const action = await loadOwnedAction(input.entrepreneur_id, input.action_id);
  const mentor = await loadMentor(input.mentor_id);
  if (!mentor || !isEligible(mentor)) throw new ToolError("NOT_ELIGIBLE", "Mentor is not verified and active.");
  const relation = must(
    await db()
      .from("bookings")
      .select("id")
      .eq("entrepreneur_id", input.entrepreneur_id)
      .eq("mentor_id", input.mentor_id)
      .neq("status", "cancelled")
      .limit(1),
    "check mentor relationship",
  ) as Array<{ id: string }>;
  if (relation.length === 0) throw new ToolError("NOT_ELIGIBLE", "Help requests go only to the mentee's own mentor.");
  must(
    await db()
      .from("progress_updates")
      .insert({
        entrepreneur_id: input.entrepreneur_id,
        action_item_id: action.id,
        kind: "mentor_requested",
        note: input.summary,
        agenda: true,
        source: "system",
        created_at: iso(env.now),
      })
      .select("id"),
    "request mentor help",
  );
  return { result: mentor, summary: `Asked ${mentor.full_name} for help; added to the next session's agenda.` };
}

const IMPLEMENTATIONS = {
  get_entrepreneur_context,
  find_matching_mentors,
  send_mentor_request,
  create_session_brief,
  extract_action_items,
  update_action_status,
  recommend_approved_resource,
  suggest_mentor_session,
  create_escalation,
  send_inbox_message,
  record_progress,
  schedule_check_in,
  request_mentor_help,
} satisfies Record<ToolName, (input: never, env: ToolEnv) => Promise<{ result: unknown; summary: string }>>;

export type ToolResult<N extends ToolName> = Awaited<ReturnType<(typeof IMPLEMENTATIONS)[N]>>["result"];

/** Platform code (routes) may call tools directly, outside an agent run. */
export async function callTool<N extends ToolName>(name: N, input: z.input<(typeof ToolInputs)[N]>, env: ToolEnv): Promise<ToolResult<N>> {
  const parsed = ToolInputs[name].parse(input);
  const impl = IMPLEMENTATIONS[name] as unknown as (i: unknown, e: ToolEnv) => Promise<{ result: ToolResult<N> }>;
  return (await impl(parsed, env)).result;
}

// ---------------------------------------------------------------------------
// Toolbox: what one agent run is allowed to use, with a call log.
// ---------------------------------------------------------------------------

function summariseInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string") out[k] = v.length > 120 ? `${v.slice(0, 117)}...` : v;
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
    else out[k] = "[object]";
  }
  return out;
}

export class Toolbox {
  readonly calls: ToolCallRecord[] = [];

  constructor(
    private readonly allowed: readonly ToolName[],
    private readonly env: ToolEnv,
  ) {}

  async call<N extends ToolName>(name: N, input: z.input<(typeof ToolInputs)[N]>): Promise<ToolResult<N>> {
    const record: ToolCallRecord = {
      tool: name,
      input: summariseInput(input as Record<string, unknown>),
      ok: false,
      summary: "",
    };
    this.calls.push(record);

    if (!this.allowed.includes(name)) {
      record.summary = "Not permitted for this event.";
      throw new ToolError("TOOL_NOT_PERMITTED", `Tool ${name} is not permitted for this event.`);
    }
    const parsed = ToolInputs[name].safeParse(input);
    if (!parsed.success) {
      record.summary = "Invalid input.";
      throw new ToolError("INVALID_INPUT", `Invalid input for ${name}.`);
    }
    try {
      const impl = IMPLEMENTATIONS[name] as unknown as (
        i: unknown,
        e: ToolEnv,
      ) => Promise<{ result: ToolResult<N>; summary: string }>;
      const out = await impl(parsed.data, this.env);
      record.ok = true;
      record.summary = out.summary;
      return out.result;
    } catch (err) {
      record.summary = err instanceof ToolError || err instanceof DbError ? err.message.slice(0, 200) : "Tool failed.";
      throw err;
    }
  }
}
