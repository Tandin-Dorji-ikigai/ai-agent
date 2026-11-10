import "server-only";
import { dzongkhaFollowUp } from "../demo/dzongkha";
import { loadActionItem, loadMentors, loadResources } from "../data";
import { db, must } from "../supabase/server";
import { expertiseLabel, type EventType, type ResultSource } from "../types";
import { aiStep } from "./ai";
import {
  fallbackAssessmentSummary,
  fallbackBriefs,
  fallbackFollowUp,
  fallbackMatchExplanations,
} from "./fallbacks";
import { SENSITIVE_TOPICS, classifyBlocker, decideNextStep, validateDecision, type DecisionContext } from "./policy";
import {
  AssessmentSummarySchema,
  BriefsSchema,
  DecisionSchema,
  FollowUpSchema,
  MatchExplanationsSchema,
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

/** Which tools each event may use. Anything else is refused by the Toolbox. */
export const ALLOWED_TOOLS: Record<EventType, readonly ToolName[]> = {
  "assessment.completed": ["get_entrepreneur_context"],
  "mentor.match.requested": ["get_entrepreneur_context", "find_matching_mentors"],
  "mentor.selected": [],
  "booking.confirmed": ["create_session_brief", "send_inbox_message"],
  "session.completed": ["extract_action_items"],
  "action.due_soon": [],
  "action.overdue": ["get_entrepreneur_context", "send_inbox_message"],
  "entrepreneur.blocked": [
    "get_entrepreneur_context",
    "update_action_status",
    "recommend_approved_resource",
    "suggest_mentor_session",
    "create_escalation",
    "send_inbox_message",
  ],
  "escalation.requested": [],
};

const iso = (d: Date) => d.toISOString();
const dayMs = 86_400_000;
const shortDate = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

function requireEntrepreneur(event: AgentEventRow): string {
  if (!event.entrepreneur_id) throw new Error("Event has no entrepreneur.");
  return event.entrepreneur_id;
}

// ---------------------------------------------------------------------------

const assessmentCompleted: Handler = async ({ event, tools, now }) => {
  const entrepreneur_id = requireEntrepreneur(event);
  const ctx = await tools.call("get_entrepreneur_context", { entrepreneur_id });
  const step = await aiStep({
    task: "assessment_summary",
    schema: AssessmentSummarySchema,
    fallback: () => fallbackAssessmentSummary(ctx.profile),
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
  const step = await aiStep({
    task: "session_briefs",
    schema: BriefsSchema,
    fallback: () => fallbackBriefs(src.entrepreneur, src.mentor, scheduled),
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
  await tools.call("send_inbox_message", {
    entrepreneur_id: src.entrepreneur.id,
    kind: "info",
    body: `Your session with ${src.mentor.full_name} is booked for ${shortDate(scheduled)}. Your preparation checklist is ready. ${src.mentor.full_name.split(" ")[0]} has a short brief about your business, so you will not start from zero.`,
    source: "system",
  });
  return {
    input_summary: `Booking with ${src.mentor.full_name} for ${src.entrepreneur.full_name}`,
    output: "Prepared an entrepreneur brief and a mentor brief.",
    source: step.source,
  };
};

const sessionCompleted: Handler = async ({ event, tools }) => {
  if (!event.entity_id) throw new Error("Event has no session.");
  const notes = String(event.payload.notes ?? "");
  const out = await tools.call("extract_action_items", { session_id: event.entity_id, notes });
  return {
    input_summary: "Mentor session notes",
    output: `${out.actions.length} draft actions extracted. Waiting for a human to confirm them.`,
    source: out.source,
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
  return {
    input_summary: `"${action.title}" passed its due date`,
    decision: "Ask about the blocker",
    factors: [`"${action.title}" is ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue.`],
    output: step.value.body,
    source: step.source,
  };
};

const DECISION_LABEL: Record<Decision["action"], string> = {
  recommend_resource: "Recommend an approved resource",
  suggest_mentor_session: "Suggest another mentor session",
  escalate: "Escalate to YDF",
};

const entrepreneurBlocked: Handler = async ({ event, tools }) => {
  const entrepreneur_id = requireEntrepreneur(event);
  const action_id = String(event.payload.action_id ?? "");
  const blocker = String(event.payload.blocker ?? "").trim();
  if (!action_id || !blocker) throw new Error("Blocker event is missing the action or the reply.");

  const ctx = await tools.call("get_entrepreneur_context", { entrepreneur_id });
  const action = await tools.call("update_action_status", { entrepreneur_id, action_id, status: "blocked", blocker });

  const sessionRow = must(
    await db().from("sessions").select("id, bookings!inner(mentor_id)").eq("id", action.session_id).maybeSingle(),
    "load session for action",
  ) as { id: string; bookings: { mentor_id: string } } | null;

  const [resources, mentors] = await Promise.all([loadResources(), loadMentors()]);
  const dctx: DecisionContext = {
    blocker,
    topics: classifyBlocker(blocker),
    resources,
    mentors,
    currentMentorId: sessionRow?.bookings.mentor_id ?? null,
    sector: ctx.profile.sector,
    actionTitle: action.title,
    entrepreneurName: ctx.profile.full_name,
  };

  const step = await aiStep({
    task: "blocker_decision",
    schema: DecisionSchema,
    fallback: () => decideNextStep(dctx),
  });
  let decision: Decision = step.value;
  let source: ResultSource = step.source;
  if (validateDecision(decision, dctx) !== null) {
    decision = decideNextStep(dctx);
    source = "fallback";
  }

  // Exactly one permitted action tool runs for the decision.
  const firstName = ctx.profile.full_name.split(" ")[0];
  const nextAction = ctx.open_actions.find((a) => a.id !== action.id && a.status === "pending");
  const keepGoing = nextAction?.due_at
    ? ` Meanwhile, keep going with "${nextAction.title}" (due ${shortDate(new Date(nextAction.due_at))}).`
    : "";
  let output: string;

  if (decision.action === "recommend_resource") {
    const resource = await tools.call("recommend_approved_resource", {
      entrepreneur_id,
      resource_id: decision.resource_id,
      action_id: action.id,
    });
    output = `Recommended "${resource.title}".`;
    await tools.call("send_inbox_message", {
      entrepreneur_id,
      kind: "recommendation",
      body: `Thanks, ${firstName}. This approved guide should help: "${resource.title}". ${resource.summary} Try it and tell me how it goes.`,
      related_action_id: action.id,
      metadata: { resource_id: resource.id },
      source,
    });
  } else if (decision.action === "suggest_mentor_session") {
    const mentor = await tools.call("suggest_mentor_session", {
      entrepreneur_id,
      mentor_id: decision.mentor_id,
      action_id: action.id,
    });
    output = `Suggested a session with ${mentor.full_name} (not booked).`;
    await tools.call("send_inbox_message", {
      entrepreneur_id,
      kind: "recommendation",
      body: `Thanks, ${firstName}. ${mentor.full_name} can help with this. Would you like to book a session? Nothing is booked until you confirm.`,
      related_action_id: action.id,
      metadata: { mentor_id: mentor.id },
      source,
    });
  } else {
    const escalation = await tools.call("create_escalation", {
      entrepreneur_id,
      action_item_id: action.id,
      session_id: action.session_id,
      reason: decision.reason,
      summary: decision.summary,
      priority: decision.priority,
    });
    const sensitive = dctx.topics.find((t) => SENSITIVE_TOPICS.has(t));
    const topic = sensitive ? expertiseLabel(sensitive).toLowerCase() : "this";
    output = `Created escalation ${escalation.code}.`;
    await tools.call("send_inbox_message", {
      entrepreneur_id,
      kind: "escalation_notice",
      body: `Thanks, ${firstName}. This needs someone qualified in ${topic}, so I have passed it to YDF (${escalation.code}). A YDF programme officer will contact you.${keepGoing}`,
      related_action_id: action.id,
      metadata: { escalation_id: escalation.id, escalation_code: escalation.code },
      source,
    });
  }

  return {
    input_summary: `${ctx.profile.full_name} reported a blocker on "${action.title}"`,
    decision: DECISION_LABEL[decision.action],
    factors: decision.factors,
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
  "action.due_soon": noop,
  "action.overdue": actionOverdue,
  "entrepreneur.blocked": entrepreneurBlocked,
  "escalation.requested": noop,
};
