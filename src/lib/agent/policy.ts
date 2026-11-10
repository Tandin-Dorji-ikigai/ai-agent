// Deterministic policies for the check-in loop (team workflow diagram,
// "Area 2: progress tracking and accountability").
//
// Two jobs:
// 1. They are the saved fallbacks for the live-AI steps (Milestone 2):
//    classifyReply() reads a mentee's reply; decideNextStep() picks the help.
// 2. They define what is *permitted*: validateDecision() rejects any AI choice
//    that points at an unapproved resource or an ineligible mentor, or that
//    skips a required escalation for sensitive topics.

import { isEligible } from "../matching/score-mentor";
import { expertiseLabel, type MentorRecord, type ResourceRecord } from "../types";
import type { Decision, ReplyClassification } from "./schemas";

const TOPIC_PATTERNS: Array<[string, RegExp]> = [
  ["regulatory_compliance", /\b(permits?|licen[cs]es?|licensing|regulat\w*|legal|laws?|clearance|rules)\b/i],
  ["business_registration", /\b(regist\w+|incorporat\w+)\b/i],
  ["tax", /\b(tax|taxes|gst)\b/i],
  ["pricing", /\b(price|prices|pricing|charge|charging|rates?)\b/i],
  ["customer_validation", /\b(customers?|guests?|interview\w*|survey\w*|demand)\b/i],
  ["market_positioning", /\b(position\w*|brand\w*|messag\w+|stand out|competitors?)\b/i],
  ["accounting", /\b(bookkeep\w*|accounts?|accounting|records?|ledger)\b/i],
  ["digital_payments", /\b(payments?|qr|wallet)\b/i],
  ["operations", /\b(staff\w*|schedul\w*|operations?|logistics)\b/i],
];

/** Topics that need a qualified person. The agent never answers these itself. */
export const SENSITIVE_TOPICS = new Set(["regulatory_compliance", "business_registration", "tax"]);

export function classifyBlocker(text: string): string[] {
  return TOPIC_PATTERNS.filter(([, re]) => re.test(text)).map(([topic]) => topic);
}

// ---------------------------------------------------------------------------
// Progress status: done / on track / stuck (and does the mentee need help?)
// ---------------------------------------------------------------------------

const DONE = /\b(done|finished|completed|did it|sorted)\b/i;
const STUCK =
  /\b(stuck|blocked|can'?t|cannot|couldn'?t|haven'?t|don'?t (know|understand)|not sure|unable|problems?|issues?|confus\w*|no time|sick|ill|delay\w*|behind)\b/i;
const ASKING_FOR_HELP = /\b(help|don'?t (know|understand)|not sure|which|how (do|can|should)|what should|confus\w*|advice)\b|\?/i;
/** Obstacles the mentee can handle alone (they just need time). */
const SELF_SOLVABLE = /\b(sick|ill|travel\w*|busy|festival|family|no time|next week|weather|catch up)\b/i;

export function classifyReply(raw: string): ReplyClassification {
  const text = raw.replace(/[‘’]/g, "'").trim();
  const summary = text.slice(0, 300) || "(empty reply)";
  const stuck = STUCK.test(text);
  if (DONE.test(text) && !stuck) return { status: "done", needs_help: false, summary };
  if (!stuck) return { status: "on_track", needs_help: false, summary };
  const sensitive = classifyBlocker(text).some((t) => SENSITIVE_TOPICS.has(t));
  const asking = ASKING_FOR_HELP.test(text);
  const needs_help = sensitive || asking || !SELF_SOLVABLE.test(text);
  return { status: "stuck", needs_help, summary };
}

// ---------------------------------------------------------------------------
// "Can the agent resolve it?" -> recommend/guide, or request a human.
// ---------------------------------------------------------------------------

export interface DecisionContext {
  blocker: string;
  topics: string[];
  resources: ResourceRecord[];
  mentors: MentorRecord[];
  currentMentorId: string | null;
  sector: string | null;
  actionTitle: string;
  entrepreneurName: string;
}

function canTakeRequests(m: MentorRecord | null | undefined): m is MentorRecord {
  return !!m && isEligible(m);
}

function otherEligibleMentorsFor(topic: string, ctx: DecisionContext): MentorRecord[] {
  return ctx.mentors
    .filter((m) => m.id !== ctx.currentMentorId && isEligible(m) && m.slots_remaining > 0 && m.expertise.includes(topic))
    .sort((a, b) => a.fee - b.fee);
}

function approvedResourcesFor(topic: string, ctx: DecisionContext): ResourceRecord[] {
  return ctx.resources.filter(
    (r) => r.approved && r.topics.includes(topic) && (r.sectors.length === 0 || (ctx.sector !== null && r.sectors.includes(ctx.sector))),
  );
}

function escalationSummary(ctx: DecisionContext, topicText: string): string {
  return `${ctx.entrepreneurName} is blocked on "${ctx.actionTitle}": "${ctx.blocker}" Topic: ${topicText}. Needs a qualified person.`.slice(0, 600);
}

const firstName = (m: MentorRecord) => m.full_name.split(" ")[0];

export function decideNextStep(ctx: DecisionContext): Decision {
  const current = ctx.mentors.find((m) => m.id === ctx.currentMentorId) ?? null;
  const sensitive = ctx.topics.filter((t) => SENSITIVE_TOPICS.has(t));

  // 1. Sensitive topics: a verified specialist (own mentor first), otherwise YDF.
  if (sensitive.length > 0) {
    const topic = sensitive[0];
    const label = expertiseLabel(topic).toLowerCase();
    if (canTakeRequests(current) && current.expertise.includes(topic)) {
      return {
        action: "request_mentor_help",
        mentor_id: current.id,
        factors: [`The blocker involves ${label}, which needs a qualified person.`, `${current.full_name} lists ${label} and already knows this business.`],
      };
    }
    const specialist = otherEligibleMentorsFor(topic, ctx)[0];
    if (specialist) {
      return {
        action: "suggest_mentor_session",
        mentor_id: specialist.id,
        factors: [
          `The blocker involves ${label}, which needs a qualified person.`,
          `${specialist.full_name} is a verified mentor who lists ${label} and has an open session.`,
        ],
      };
    }
    const factors = [`The blocker involves ${label}, which needs a qualified person.`];
    factors.push(
      approvedResourcesFor(topic, ctx).length === 0
        ? `No approved resource covers ${label}.`
        : `Approved resources are not a substitute for qualified advice on ${label}.`,
    );
    if (current && !current.expertise.includes(topic)) {
      factors.push(`The current mentor (${current.full_name}) does not list ${label}.`);
    }
    factors.push(`No verified mentor with open sessions lists ${label}.`);
    return {
      action: "escalate",
      reason: "specialist_required",
      priority: "medium",
      summary: escalationSummary(ctx, label),
      factors: factors.slice(0, 5),
    };
  }

  // 2. Non-sensitive: the agent resolves it with an approved resource if it
  //    can; otherwise the mentee's own mentor; otherwise another mentor.
  for (const topic of ctx.topics) {
    const label = expertiseLabel(topic).toLowerCase();
    const resource = approvedResourcesFor(topic, ctx)[0];
    if (resource) {
      return {
        action: "recommend_resource",
        resource_id: resource.id,
        factors: [`The blocker is about ${label}.`, `"${resource.title}" is an approved resource on ${label}.`],
      };
    }
    if (canTakeRequests(current) && current.expertise.includes(topic)) {
      return {
        action: "request_mentor_help",
        mentor_id: current.id,
        factors: [
          `The blocker is about ${label}.`,
          `No approved resource covers ${label}.`,
          `${firstName(current)} lists ${label}, so it goes on the agenda for the next session.`,
        ],
      };
    }
    const other = otherEligibleMentorsFor(topic, ctx)[0];
    if (other) {
      return {
        action: "suggest_mentor_session",
        mentor_id: other.id,
        factors: [
          `The blocker is about ${label}.`,
          `No approved resource covers ${label}.`,
          `${other.full_name} is a verified mentor who lists ${label} and has an open session.`,
        ],
      };
    }
  }

  // 3. Unclear blocker: ask the mentee's own mentor, else YDF.
  if (canTakeRequests(current)) {
    return {
      action: "request_mentor_help",
      mentor_id: current.id,
      factors: [
        "The blocker does not match an approved resource.",
        `${current.full_name} already knows this business, so it goes on the agenda for the next session.`,
      ],
    };
  }
  return {
    action: "escalate",
    reason: "other",
    priority: "low",
    summary: escalationSummary(ctx, "unclear"),
    factors: ["The blocker does not match an approved resource or an available mentor."],
  };
}

/** Returns null if the decision is permitted, otherwise the reason it is not. */
export function validateDecision(decision: Decision, ctx: DecisionContext): string | null {
  const sensitiveTopics = ctx.topics.filter((t) => SENSITIVE_TOPICS.has(t));
  const sensitive = sensitiveTopics.length > 0;
  switch (decision.action) {
    case "recommend_resource": {
      const r = ctx.resources.find((x) => x.id === decision.resource_id);
      if (!r) return "Resource does not exist.";
      if (!r.approved) return "Resource is not approved.";
      if (sensitive) return "Sensitive topics need a qualified person, not a resource.";
      return null;
    }
    case "suggest_mentor_session": {
      const m = ctx.mentors.find((x) => x.id === decision.mentor_id);
      if (!m) return "Mentor does not exist.";
      if (!isEligible(m)) return "Mentor is not verified and active.";
      if (m.slots_remaining < 1) return "Mentor is fully booked.";
      if (sensitive && !sensitiveTopics.some((t) => m.expertise.includes(t))) return "Mentor does not list the sensitive topic.";
      return null;
    }
    case "request_mentor_help": {
      if (decision.mentor_id !== ctx.currentMentorId) return "Help requests go only to the mentee's own mentor.";
      const m = ctx.mentors.find((x) => x.id === decision.mentor_id);
      if (!m || !isEligible(m)) return "Mentor is not verified and active.";
      if (sensitive && !sensitiveTopics.some((t) => m.expertise.includes(t))) return "Mentor does not list the sensitive topic.";
      return null;
    }
    case "escalate":
      return null;
  }
}
