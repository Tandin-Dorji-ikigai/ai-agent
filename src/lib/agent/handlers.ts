import "server-only";
import { dzongkhaFollowUp } from "../demo/dzongkha";
import { loadActionItem, loadMentors, loadResources } from "../data";
import { buildAgenda, type AgendaItem } from "../progress";
import { db, must } from "../supabase/server";
import {
  expertiseLabel,
  type ActionItemRecord,
  type EventType,
  type ProgressUpdateRecord,
  type ResultSource,
} from "../types";
import { aiStep } from "./ai";
import { live } from "./live";
import { hasGenderedPronoun, rejectGenderedText } from "./prompts";
import {
  fallbackAssessmentSummary,
  fallbackBriefs,
  fallbackCheckIn,
  fallbackFollowUp,
  fallbackMatchExplanations,
} from "./fallbacks";
import { SENSITIVE_TOPICS, classifyBlocker, classifyReply, decideNextStep, validateDecision, type DecisionContext } from "./policy";
import {
  AssessmentSummarySchema,
  BriefsSchema,
  DecisionSchema,
  FollowUpSchema,
  MatchExplanationsSchema,
  ReplyClassificationSchema,
  type Decision,
  type ToolName,
} from "./schemas";
import type { Toolbox } from "./tools";

export interface AgentEventRow {
  id: string;
  event_type: EventType;
  entity_type: string;
  entity_id: string | null;
  entrepreneur_id: string | null;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
}

export interface HandlerContext {
  event: AgentEventRow;
  tools: Toolbox;
  now: Date;
}

export interface HandlerResult {
  input_summary: string;
  output: string;
  source: ResultSource | null;
  decision?: string;
  factors?: string[];
}

type Handler = (ctx: HandlerContext) => Promise<HandlerResult>;

const REPLY_TOOLS: readonly ToolName[] = [
  "get_entrepreneur_context",
  "update_action_status",
  "record_progress",
  "schedule_check_in",
  "recommend_approved_resource",
  "request_mentor_help",
  "suggest_mentor_session",
  "create_escalation",
  "send_inbox_message",
];

/** Which tools each event may use. Anything else is refused by the Toolbox. */
export const ALLOWED_TOOLS: Record<EventType, readonly ToolName[]> = {
  "assessment.completed": ["get_entrepreneur_context"],
  "mentor.match.requested": ["get_entrepreneur_context", "find_matching_mentors"],
  "mentor.selected": [],
  "booking.confirmed": ["create_session_brief", "send_inbox_message"],
  "session.completed": ["extract_action_items"],
  "action.due_soon": ["get_entrepreneur_context", "send_inbox_message"],
  "action.overdue": ["get_entrepreneur_context", "send_inbox_message"],
  "checkin.replied": REPLY_TOOLS,
  "entrepreneur.blocked": REPLY_TOOLS,
  "escalation.requested": [],
};

const iso = (d: Date) => d.toISOString();
const dayMs = 86_400_000;
const shortDate = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

function requireEntrepreneur(event: AgentEventRow): string {
  if (!event.entrepreneur_id) throw new Error("Event has no entrepreneur.");
  return event.entrepreneur_id;
}

/** Progress agenda for a follow-up session with the same mentor (empty for a first session). */
async function agendaFor(entrepreneurId: string, mentorId: string, firstName: string, bookingId: string): Promise<AgendaItem[]> {
  const previous = must(
    await db()
      .from("bookings")
      .select("id")
      .eq("entrepreneur_id", entrepreneurId)
      .eq("mentor_id", mentorId)
      .eq("status", "completed")
      .neq("id", bookingId)
      .limit(1),
    "load previous sessions",
  ) as Array<{ id: string }>;
  if (previous.length === 0) return [];
  const [actions, updates, escalations] = await Promise.all([
    db().from("action_items").select("*").eq("entrepreneur_id", entrepreneurId),
    db().from("progress_updates").select("*").eq("entrepreneur_id", entrepreneurId),
    db().from("escalations").select("code, action_item_id, status").eq("entrepreneur_id", entrepreneurId),
  ]);
  return buildAgenda({
    entrepreneurFirstName: firstName,
    actions: must(actions, "load actions") as ActionItemRecord[],
    updates: must(updates, "load progress") as ProgressUpdateRecord[],
    escalations: must(escalations, "load escalations") as Array<{ code: string; action_item_id: string | null; status: string }>,
  });
}

// ---------------------------------------------------------------------------
// Area 1 and setup: assessment, matching, booking, session notes
// ---------------------------------------------------------------------------

const assessmentCompleted: Handler = async ({ event, tools, now }) => {
  const entrepreneur_id = requireEntrepreneur(event);
  const ctx = await tools.call("get_entrepreneur_context", { entrepreneur_id });
  const step = await aiStep({
    task: "assessment_summary",
    schema: AssessmentSummarySchema,
    fallback: () => fallbackAssessmentSummary(ctx.profile),
    live: live.assessmentSummary(ctx.profile),
    validate: rejectGenderedText,
  });
  must(
    await db()
      .from("entrepreneur_profiles")
      .update({ assessment_summary: step.value.summary, assessment_source: step.source, updated_at: iso(now) })
      .eq("user_id", entrepreneur_id)
      .select("user_id"),
    "save assessment summary",
  );
  return {
    input_summary: `Needs assessment from ${ctx.profile.full_name}`,
    output: step.value.summary,
    source: step.source,
  };
};

const matchRequested: Handler = async ({ event, tools, now }) => {
  const entrepreneur_id = requireEntrepreneur(event);
  const ctx = await tools.call("get_entrepreneur_context", { entrepreneur_id });
  const ranked = await tools.call("find_matching_mentors", { entrepreneur_id, limit: 3 });

  const step = await aiStep({
    task: "match_explanations",
    schema: MatchExplanationsSchema,
    fallback: () => fallbackMatchExplanations(ctx.profile, ranked),
    live: live.matchExplanations(ctx.profile, ranked),
    validate: rejectGenderedText,
  });

  // Grounding check: the AI may only explain the mentors the backend ranked.
  let explanations = step.value.explanations;
  let source: ResultSource = step.source;
  const rankedIds = ranked.map((r) => r.mentor.id).sort().join();
  if (explanations.map((x) => x.mentor_id).sort().join() !== rankedIds) {
    explanations = fallbackMatchExplanations(ctx.profile, ranked).explanations;
    source = "fallback";
  }
  const byId = new Map(explanations.map((x) => [x.mentor_id, x.explanation]));

  must(await db().from("mentor_matches").delete().eq("entrepreneur_id", entrepreneur_id).select("id"), "clear matches");
  if (ranked.length > 0) {
    must(
      await db()
        .from("mentor_matches")
        .insert(
          ranked.map((r, i) => ({
            entrepreneur_id,
            mentor_id: r.mentor.id,
            rank: i + 1,
            score: r.score,
            score_breakdown: r.breakdown,
            explanation: byId.get(r.mentor.id) ?? null,
            explanation_source: source,
            created_at: iso(now),
          })),
        )
        .select("id"),
      "save matches",
    );
  }

  return {
    input_summary: `Match request for ${ctx.profile.full_name}`,
    output: `Recommended ${ranked.map((r) => `${r.mentor.full_name} (${r.score}/100)`).join(", ")}.`,
    factors: ranked.map((r, i) => `#${i + 1} ${r.mentor.full_name}: ${r.score}/100 from the deterministic score.`),
    source,
  };
};

const bookingConfirmed: Handler = async ({ event, tools, now }) => {
  if (!event.entity_id) throw new Error("Event has no booking.");
  const src = await tools.call("create_session_brief", { booking_id: event.entity_id });
  const scheduled = new Date(src.booking.scheduled_at);
  const agenda = await agendaFor(src.entrepreneur.id, src.mentor.id, src.entrepreneur.full_name.split(" ")[0], src.booking.id);
  const step = await aiStep({
    task: "session_briefs",
    schema: BriefsSchema,
    fallback: () => fallbackBriefs(src.entrepreneur, src.mentor, scheduled, agenda),
    live: live.briefs(src.entrepreneur, src.mentor, scheduled, agenda),
    validate: rejectGenderedText,
  });
  must(
    await db()
      .from("bookings")
      .update({
        entrepreneur_brief: step.value.entrepreneur,
        mentor_brief: step.value.mentor,
        brief_source: step.source,
        updated_at: iso(now),
      })
      .eq("id", src.booking.id)
      .select("id"),
    "save briefs",
  );
  const mentorFirst = src.mentor.full_name.split(" ")[0];
  await tools.call("send_inbox_message", {
    entrepreneur_id: src.entrepreneur.id,
    kind: "info",
    body:
      agenda.length > 0
        ? `Your follow-up session with ${src.mentor.full_name} is booked for ${shortDate(scheduled)}. ${mentorFirst} has your progress since the last session, so you can pick up where you left off.`
        : `Your session with ${src.mentor.full_name} is booked for ${shortDate(scheduled)}. Your preparation checklist is ready. ${mentorFirst} has a short brief about your business, so you will not start from zero.`,
    source: "system",
  });
  return {
    input_summary: `${agenda.length > 0 ? "Follow-up booking" : "Booking"} with ${src.mentor.full_name} for ${src.entrepreneur.full_name}`,
    output: agenda.length > 0 ? `Prepared follow-up briefs from ${agenda.length} progress item(s).` : "Prepared an entrepreneur brief and a mentor brief.",
    source: step.source,
  };
};

const sessionCompleted: Handler = async ({ event, tools }) => {
  if (!event.entity_id) throw new Error("Event has no session.");
  const notes = String(event.payload.notes ?? "");
  const source = (["typed", "voice_note", "call_recording"] as const).find((s) => s === event.payload.source) ?? "typed";
  const out = await tools.call("extract_action_items", { session_id: event.entity_id, notes, source });
  const label = { typed: "typed notes", voice_note: "voice note", call_recording: "call transcript" }[source];
  return {
    input_summary: `Mentor session ${label} (${notes.length.toLocaleString("en-IN")} characters)`,
    output:
      `${out.actions.length} draft SMART actions extracted` +
      (out.parts > 1 ? ` from a ${out.parts}-part transcript (${out.liveParts} part${out.liveParts === 1 ? "" : "s"} read by live AI)` : "") +
      ". Waiting for a human to confirm them.",
    source: out.source,
  };
};

// ---------------------------------------------------------------------------
// Area 2: the scheduling agent starts a conversation on progress
// ---------------------------------------------------------------------------

async function markCheckInSent(actionId: string, now: Date) {
  must(
    await db()
      .from("action_items")
      .update({ last_check_in_at: iso(now), next_check_in_at: null, updated_at: iso(now) })
      .eq("id", actionId)
      .select("id"),
    "mark check-in sent",
  );
}

/** Scheduled check-in before the due date (or after a reschedule). */
const checkInDue: Handler = async ({ event, tools, now }) => {
  const entrepreneur_id = requireEntrepreneur(event);
  if (!event.entity_id) throw new Error("Event has no action.");
  const ctx = await tools.call("get_entrepreneur_context", { entrepreneur_id });
  const action = ctx.open_actions.find((a) => a.id === event.entity_id);
  if (!action) {
    return { input_summary: "Scheduled check-in", output: "The action is no longer open; no check-in sent.", source: null };
  }
  const step = await aiStep({
    task: "progress_check_in",
    schema: FollowUpSchema,
    fallback: () => fallbackCheckIn(ctx.profile, action.title, action.due_at ? new Date(action.due_at) : null),
    live: live.checkIn(ctx.profile, action.title, action.due_at ? new Date(action.due_at) : null, action.success_measure),
    validate: rejectGenderedText,
  });
  await tools.call("send_inbox_message", {
    entrepreneur_id,
    kind: "check_in",
    body: step.value.body,
    related_action_id: action.id,
    awaiting_reply: true,
    source: step.source,
  });
  await markCheckInSent(action.id, now);
  const daysLeft = action.due_at ? Math.round((new Date(action.due_at).getTime() - now.getTime()) / dayMs) : null;
  return {
    input_summary: `Scheduled check-in on "${action.title}"`,
    decision: "Check in on progress",
    factors: [daysLeft !== null && daysLeft >= 0 ? `"${action.title}" is due in ${daysLeft} day(s).` : `A check-in on "${action.title}" was scheduled.`],
    output: step.value.body,
    source: step.source,
  };
};

const actionOverdue: Handler = async ({ event, tools, now }) => {
  const entrepreneur_id = requireEntrepreneur(event);
  if (!event.entity_id) throw new Error("Event has no action.");
  const ctx = await tools.call("get_entrepreneur_context", { entrepreneur_id });
  const action = ctx.open_actions.find((a) => a.id === event.entity_id) ?? (await loadActionItem(event.entity_id));
  if (!action) throw new Error("Action not found.");
  const daysOverdue = Math.max(1, Math.floor((now.getTime() - new Date(action.due_at ?? now).getTime()) / dayMs));

  const step = await aiStep({
    task: "overdue_follow_up",
    schema: FollowUpSchema,
    fallback: () => fallbackFollowUp(ctx.profile, action.title, daysOverdue),
    live: live.overdue(ctx.profile, action.title, daysOverdue),
    validate: rejectGenderedText,
  });
  const dz = dzongkhaFollowUp(action.title);
  await tools.call("send_inbox_message", {
    entrepreneur_id,
    kind: "follow_up",
    body: step.value.body,
    body_dz: dz.body_dz,
    dz_verified: dz.dz_verified,
    related_action_id: action.id,
    awaiting_reply: true,
    source: step.source,
  });
  await markCheckInSent(action.id, now);
  return {
    input_summary: `"${action.title}" passed its due date`,
    decision: "Ask about the blocker",
    factors: [`"${action.title}" is ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue.`],
    output: step.value.body,
    source: step.source,
  };
};

// ---------------------------------------------------------------------------
// Area 2: mentee response -> update progress -> progress status -> branch
// ---------------------------------------------------------------------------

const DECISION_LABEL: Record<Decision["action"], string> = {
  recommend_resource: "Recommend an approved resource",
  request_mentor_help: "Ask the mentor for help",
  suggest_mentor_session: "Suggest another mentor session",
  escalate: "Escalate to YDF",
};

/** Days until the next check-in: before the due date if there is time, else in 2 to 3 days. */
function nextCheckInDays(action: ActionItemRecord, now: Date, fallbackDays: number): number {
  if (!action.due_at) return fallbackDays;
  const untilDue = Math.floor((new Date(action.due_at).getTime() - now.getTime()) / dayMs);
  return untilDue >= 1 ? Math.min(untilDue, 2) : fallbackDays;
}

const checkInReplied: Handler = async ({ event, tools, now }) => {
  const entrepreneur_id = requireEntrepreneur(event);
  const action_id = String(event.payload.action_id ?? "");
  const reply = String(event.payload.reply ?? event.payload.blocker ?? "").trim();
  if (!action_id || !reply) throw new Error("Reply event is missing the action or the reply.");

  const ctx = await tools.call("get_entrepreneur_context", { entrepreneur_id });
  const action = await loadActionItem(action_id);
  if (!action || action.entrepreneur_id !== entrepreneur_id) throw new Error("Action not found.");
  const firstName = ctx.profile.full_name.split(" ")[0];

  const sessionRow = must(
    await db().from("sessions").select("id, bookings!inner(mentor_id)").eq("id", action.session_id).maybeSingle(),
    "load session for action",
  ) as { id: string; bookings: { mentor_id: string } } | null;
  const mentors = await loadMentors();
  const currentMentor = mentors.find((m) => m.id === sessionRow?.bookings.mentor_id) ?? null;
  const mentorFirst = currentMentor ? currentMentor.full_name.split(" ")[0] : "your mentor";

  // Progress status?
  const read = await aiStep({
    task: "classify_reply",
    schema: ReplyClassificationSchema,
    fallback: () => classifyReply(reply),
    live: live.classifyReply(action.title, reply, firstName),
  });
  // Keep the live classification, but never show the mentor a gender guess:
  // fall back to the mentee's own words for the summary.
  const status = hasGenderedPronoun(read.value.summary) ? { ...read.value, summary: reply.slice(0, 300) } : read.value;
  const statusFactor = `Reply read as: ${status.status === "on_track" ? "on track" : status.status}${status.status === "stuck" ? (status.needs_help ? ", needs help" : ", no help needed") : ""}.`;
  const base = { input_summary: `${ctx.profile.full_name} replied about "${action.title}"` };

  // Done -> mark done, tell the mentor.
  if (status.status === "done") {
    await tools.call("update_action_status", { entrepreneur_id, action_id, status: "completed" });
    await tools.call("record_progress", { entrepreneur_id, action_id, kind: "done", note: status.summary, source: read.source });
    await tools.call("send_inbox_message", {
      entrepreneur_id,
      kind: "info",
      body: `Well done, ${firstName}. "${action.title}" is marked as done and ${mentorFirst} can see it.`,
      related_action_id: action_id,
      source: "system",
    });
    return { ...base, decision: "Mark done", factors: [statusFactor], output: `"${action.title}" completed.`, source: read.source };
  }

  // On track -> record progress, confirm the next check-in.
  if (status.status === "on_track") {
    const days = nextCheckInDays(action, now, 2);
    const next = await tools.call("schedule_check_in", { entrepreneur_id, action_id, in_days: days });
    await tools.call("record_progress", { entrepreneur_id, action_id, kind: "on_track", note: status.summary, source: read.source });
    await tools.call("send_inbox_message", {
      entrepreneur_id,
      kind: "info",
      body: `Good to hear, ${firstName}. I have noted your progress for ${mentorFirst}. I will check in again on ${shortDate(new Date(next.at))}.`,
      related_action_id: action_id,
      source: "system",
    });
    return {
      ...base,
      decision: "On track: confirm next check-in",
      factors: [statusFactor, `Next check-in on ${shortDate(new Date(next.at))}.`],
      output: `Next check-in scheduled for ${shortDate(new Date(next.at))}.`,
      source: read.source,
    };
  }

  // Stuck, no help needed -> record the obstacle, check in again later.
  if (!status.needs_help) {
    const next = await tools.call("schedule_check_in", { entrepreneur_id, action_id, in_days: 3 });
    await tools.call("record_progress", { entrepreneur_id, action_id, kind: "obstacle", note: status.summary, agenda: true, source: read.source });
    await tools.call("send_inbox_message", {
      entrepreneur_id,
      kind: "info",
      body: `Thanks for telling me, ${firstName}. I have noted this for ${mentorFirst}. I will check in again on ${shortDate(new Date(next.at))}. Reply any time if you want help.`,
      related_action_id: action_id,
      source: "system",
    });
    return {
      ...base,
      decision: "Record obstacle",
      factors: [statusFactor, "The mentee expects to handle it alone, so no help was offered.", `Next check-in on ${shortDate(new Date(next.at))}.`],
      output: "Obstacle recorded for the mentor.",
      source: read.source,
    };
  }

  // Stuck and needs help -> can the agent resolve it?
  const blocked = await tools.call("update_action_status", { entrepreneur_id, action_id, status: "blocked", blocker: reply });
  const resources = await loadResources();
  const dctx: DecisionContext = {
    blocker: reply,
    topics: classifyBlocker(reply),
    resources,
    mentors,
    currentMentorId: currentMentor?.id ?? null,
    sector: ctx.profile.sector,
    actionTitle: blocked.title,
    entrepreneurName: ctx.profile.full_name,
  };
  const step = await aiStep({
    task: "blocker_decision",
    schema: DecisionSchema,
    fallback: () => decideNextStep(dctx),
    live: live.decision(dctx),
    validate: rejectGenderedText,
  });
  let decision: Decision = step.value;
  let source: ResultSource = step.source;
  if (validateDecision(decision, dctx) !== null) {
    decision = decideNextStep(dctx);
    source = "fallback";
  }

  const nextAction = ctx.open_actions.find((a) => a.id !== action_id && a.status === "pending");
  const keepGoing = nextAction?.due_at ? ` Meanwhile, keep going with "${nextAction.title}" (due ${shortDate(new Date(nextAction.due_at))}).` : "";
  let output: string;

  // Exactly one permitted action tool runs for the decision.
  if (decision.action === "recommend_resource") {
    const resource = await tools.call("recommend_approved_resource", { entrepreneur_id, resource_id: decision.resource_id, action_id });
    const next = await tools.call("schedule_check_in", { entrepreneur_id, action_id, in_days: 3 });
    await tools.call("record_progress", {
      entrepreneur_id,
      action_id,
      kind: "resource_recommended",
      note: `Recommended "${resource.title}" for: ${status.summary}`.slice(0, 600),
      source,
    });
    output = `Recommended "${resource.title}".`;
    await tools.call("send_inbox_message", {
      entrepreneur_id,
      kind: "recommendation",
      body: `Thanks, ${firstName}. This approved guide should help: "${resource.title}". ${resource.summary} I will check in on ${shortDate(new Date(next.at))} to see how it went.`,
      related_action_id: action_id,
      metadata: { resource_id: resource.id },
      source,
    });
  } else if (decision.action === "request_mentor_help") {
    const mentor = await tools.call("request_mentor_help", {
      entrepreneur_id,
      mentor_id: decision.mentor_id,
      action_id,
      summary: status.summary,
    });
    output = `Asked ${mentor.full_name} for help; added to the next session's agenda.`;
    await tools.call("send_inbox_message", {
      entrepreneur_id,
      kind: "recommendation",
      body: `Thanks, ${firstName}. ${mentor.full_name.split(" ")[0]} can help with this, so I have asked and added it to the agenda for your next session.${keepGoing}`,
      related_action_id: action_id,
      metadata: { mentor_request: true },
      source,
    });
  } else if (decision.action === "suggest_mentor_session") {
    const mentor = await tools.call("suggest_mentor_session", { entrepreneur_id, mentor_id: decision.mentor_id, action_id });
    await tools.call("record_progress", {
      entrepreneur_id,
      action_id,
      kind: "mentor_session_suggested",
      note: `Suggested a session with ${mentor.full_name} for: ${status.summary}`.slice(0, 600),
      source,
    });
    output = `Suggested a session with ${mentor.full_name} (not booked).`;
    await tools.call("send_inbox_message", {
      entrepreneur_id,
      kind: "recommendation",
      body: `Thanks, ${firstName}. ${mentor.full_name} can help with this. Would you like to book a session? Nothing is booked until you confirm.`,
      related_action_id: action_id,
      metadata: { mentor_id: mentor.id },
      source,
    });
  } else {
    const escalation = await tools.call("create_escalation", {
      entrepreneur_id,
      action_item_id: action_id,
      session_id: blocked.session_id,
      reason: decision.reason,
      summary: decision.summary,
      priority: decision.priority,
    });
    await tools.call("record_progress", {
      entrepreneur_id,
      action_id,
      kind: "escalated",
      note: `${escalation.code}: ${status.summary}`.slice(0, 600),
      agenda: true,
      source,
    });
    const sensitive = dctx.topics.find((t) => SENSITIVE_TOPICS.has(t));
    const topic = sensitive ? expertiseLabel(sensitive).toLowerCase() : "this";
    output = `Created escalation ${escalation.code}.`;
    await tools.call("send_inbox_message", {
      entrepreneur_id,
      kind: "escalation_notice",
      body: `Thanks, ${firstName}. This needs someone qualified in ${topic}, so I have passed it to YDF (${escalation.code}). A YDF programme officer will contact you.${keepGoing}`,
      related_action_id: action_id,
      metadata: { escalation_id: escalation.id, escalation_code: escalation.code },
      source,
    });
  }

  return {
    ...base,
    decision: DECISION_LABEL[decision.action],
    factors: [statusFactor, ...decision.factors],
    output,
    source,
  };
};

const noop: Handler = async ({ event }) => ({
  input_summary: event.event_type,
  output: "No agent action needed.",
  source: null,
});

export const HANDLERS: Record<EventType, Handler> = {
  "assessment.completed": assessmentCompleted,
  "mentor.match.requested": matchRequested,
  "mentor.selected": noop,
  "booking.confirmed": bookingConfirmed,
  "session.completed": sessionCompleted,
  "action.due_soon": checkInDue,
  "action.overdue": actionOverdue,
  "checkin.replied": checkInReplied,
  "entrepreneur.blocked": checkInReplied,
  "escalation.requested": noop,
};
