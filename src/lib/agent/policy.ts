// Deterministic decision policy for a reported blocker.
//
// Two jobs:
// 1. It is the saved fallback for the live-AI decision (Milestone 2).
// 2. It defines what is *permitted*: validateDecision() rejects any AI choice
//    that points at an unapproved resource, an ineligible mentor, or skips a
//    required escalation for sensitive topics.

import { isEligible } from "../matching/score-mentor";
import { expertiseLabel, type MentorRecord, type ResourceRecord } from "../types";
import type { Decision } from "./schemas";

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

function eligibleMentorsFor(topic: string, ctx: DecisionContext): MentorRecord[] {
  return ctx.mentors
    .filter((m) => isEligible(m) && m.slots_remaining > 0 && m.expertise.includes(topic))
    .sort((a, b) => Number(b.id === ctx.currentMentorId) - Number(a.id === ctx.currentMentorId) || a.fee - b.fee);
}

function approvedResourcesFor(topic: string, ctx: DecisionContext): ResourceRecord[] {
  return ctx.resources.filter(
    (r) => r.approved && r.topics.includes(topic) && (r.sectors.length === 0 || (ctx.sector !== null && r.sectors.includes(ctx.sector))),
  );
}

function escalationSummary(ctx: DecisionContext, topicText: string): string {
  return `${ctx.entrepreneurName} is blocked on "${ctx.actionTitle}": "${ctx.blocker}" Topic: ${topicText}. Needs a qualified person.`.slice(0, 600);
}

export function decideNextStep(ctx: DecisionContext): Decision {
  const currentMentor = ctx.mentors.find((m) => m.id === ctx.currentMentorId) ?? null;
  const sensitive = ctx.topics.filter((t) => SENSITIVE_TOPICS.has(t));

  // 1. Sensitive topics: a verified specialist mentor, otherwise YDF.
  if (sensitive.length > 0) {
    const topic = sensitive[0];
    const label = expertiseLabel(topic).toLowerCase();
    const mentor = eligibleMentorsFor(topic, ctx)[0];
    if (mentor) {
      return {
        action: "suggest_mentor_session",
        mentor_id: mentor.id,
        factors: [
          `The blocker involves ${label}, which needs a qualified person.`,
          `${mentor.full_name} is a verified mentor who lists ${label} and has an open session.`,
        ],
      };
    }
    const factors = [`The blocker involves ${label}, which needs a qualified person.`];
    factors.push(
      approvedResourcesFor(topic, ctx).length === 0
        ? `No approved resource covers ${label}.`
        : `Approved resources are not a substitute for qualified advice on ${label}.`,
    );
    if (currentMentor && !currentMentor.expertise.includes(topic)) {
      factors.push(`The current mentor (${currentMentor.full_name}) does not list ${label}.`);
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

  // 2. Non-sensitive topics: approved resource, then a mentor session.
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
    const mentor = eligibleMentorsFor(topic, ctx)[0];
    if (mentor) {
      return {
        action: "suggest_mentor_session",
        mentor_id: mentor.id,
        factors: [
          `The blocker is about ${label}.`,
          `No approved resource covers ${label}.`,
          `${mentor.full_name} is a verified mentor who lists ${label} and has an open session.`,
        ],
      };
    }
  }

  // 3. Unclear blocker: a follow-up with the current mentor if possible, else YDF.
  if (currentMentor && isEligible(currentMentor) && currentMentor.slots_remaining > 0) {
    return {
      action: "suggest_mentor_session",
      mentor_id: currentMentor.id,
      factors: [
        "The blocker does not match an approved resource.",
        `${currentMentor.full_name} already knows this business and has an open session.`,
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
  const sensitive = ctx.topics.some((t) => SENSITIVE_TOPICS.has(t));
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
      if (sensitive && !ctx.topics.some((t) => SENSITIVE_TOPICS.has(t) && m.expertise.includes(t))) {
        return "Mentor does not list the sensitive topic.";
      }
      return null;
    }
    case "escalate":
      return null;
  }
}
