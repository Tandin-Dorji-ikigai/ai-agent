// The agent activity timeline: what the agent has done for the mentee so far,
// oldest first, then what it does next. Built only from saved records (the
// assessment, matches, requests, bookings and reminders), so every line is
// something that really happened. Pure, so it is unit-tested.

import { expertiseLabel, sectorLabel, stageLabel } from "./types";
import type { MentorRequestView, TimelineItem, TimelineKind } from "./state-types";

export interface TimelineInput {
  entrepreneur: {
    assessment_completed_at: string | null;
    assessment_summary: string | null;
    business_stage: string | null;
    sector: string | null;
    expertise_needs: string[];
  } | null;
  /** The ranked matches (rank 1 first), with when they were made. */
  matches: Array<{ rank: number; score: number; mentor: { full_name: string } }>;
  matched_at: string | null;
  /** How many verified mentors the matching scored. */
  compared_count: number;
  /** Every request the agent sent, oldest first. */
  requests: MentorRequestView[];
  /** The latest booking, for one made without a request (seeded demo data). */
  booking: { id: string; scheduled_at: string; created_at: string | null; mentor: { full_name: string } } | null;
  /** The agent's reminders about agreed next steps. */
  reminders: Array<{ id: string; created_at: string; related_action_id: string | null; body: string }>;
  action_titles: Record<string, string>;
}

const ORDER: TimelineKind[] = ["assessed", "support", "compared", "selected", "requested", "scheduled", "reminded"];
const FIRST = new Set<TimelineKind>(["assessed", "support", "compared", "selected"]);

/** What each step says before it has happened. */
const UPCOMING: Record<TimelineKind, string> = {
  assessed: "Reads your needs assessment",
  support: "Works out the support you need",
  compared: "Compares verified mentors",
  selected: "Selects your best match",
  requested: "Asks that mentor for you",
  scheduled: "Books the session at a time the mentor picks",
  reminded: "Reminds you about the next steps you agree",
};

const REQUEST_OUTCOME: Record<string, string> = {
  pending: "Waiting for a reply.",
  accepted: "Said yes.",
  declined: "Could not take it, so the agent moved on.",
  expired: "Did not reply in time, so the agent moved on.",
  cancelled: "Request withdrawn.",
};

/** A follow-up goes to one mentor only: a no is passed on to the mentee, nobody else is asked. */
const FOLLOW_UP_OUTCOME: Record<string, string> = {
  ...REQUEST_OUTCOME,
  declined: "Could not take it this time, so the agent told you.",
  expired: "Did not reply in time, so the agent told you.",
};

const firstName = (full: string) => full.split(" ")[0];

export function sessionWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Thimphu",
  }).format(new Date(iso));
}

export function agentTimeline(input: TimelineInput): TimelineItem[] {
  const e = input.entrepreneur;
  const done: Array<Omit<TimelineItem, "status">> = [];

  if (e?.assessment_completed_at) {
    const at = e.assessment_completed_at;
    const profile = [stageLabel(e.business_stage), sectorLabel(e.sector)].filter(Boolean).join(" · ");
    done.push({ key: "assessed", kind: "assessed", title: "Assessed your needs", detail: e.assessment_summary?.trim() || profile, at });
    if (e.expertise_needs.length > 0) {
      done.push({ key: "support", kind: "support", title: "Identified the support you need", detail: e.expertise_needs.map(expertiseLabel).join(", "), at });
    }
  }

  const top = [...input.matches].sort((a, b) => a.rank - b.rank)[0];
  if (top) {
    const at = input.matched_at ?? e?.assessment_completed_at ?? null;
    const n = Math.max(input.compared_count, input.matches.length);
    done.push({
      key: "compared",
      kind: "compared",
      title: "Compared verified mentors",
      detail: `Scored ${n} verified mentor${n === 1 ? "" : "s"} on expertise, sector, stage, language, availability and budget.`,
      at,
    });
    done.push({ key: "selected", kind: "selected", title: "Selected your best match", detail: `${top.mentor.full_name}, ${top.score}/100.`, at });
  }

  const booked = new Set<string>();
  for (const r of input.requests) {
    const name = r.mentor.full_name;
    done.push({
      key: `request-${r.id}`,
      kind: "requested",
      title: r.kind === "direct" ? `Asked ${firstName(name)} for a follow-up session` : `Asked ${name} to mentor you`,
      detail: (r.kind === "direct" ? FOLLOW_UP_OUTCOME : REQUEST_OUTCOME)[r.status] ?? "",
      at: r.created_at,
    });
    if (r.status === "accepted" && r.booking_id && r.scheduled_at) {
      booked.add(r.booking_id);
      done.push({
        key: `booking-${r.booking_id}`,
        kind: "scheduled",
        title: r.kind === "direct" ? "Scheduled your follow-up session" : "Scheduled your session",
        detail: `With ${name}, ${sessionWhen(r.scheduled_at)}, Bhutan time.`,
        at: r.responded_at ?? r.created_at,
      });
    }
  }
  if (input.booking && !booked.has(input.booking.id)) {
    done.push({
      key: `booking-${input.booking.id}`,
      kind: "scheduled",
      title: "Scheduled your session",
      detail: `With ${input.booking.mentor.full_name}, ${sessionWhen(input.booking.scheduled_at)}, Bhutan time.`,
      at: input.booking.created_at,
    });
  }

  for (const m of input.reminders) {
    const title = m.related_action_id ? input.action_titles[m.related_action_id] : undefined;
    done.push({
      key: `reminder-${m.id}`,
      kind: "reminded",
      title: "Sent you a reminder",
      detail: title ? `About “${title}”.` : m.body.slice(0, 120),
      at: m.created_at,
    });
  }

  // The assessment steps come first in their own order (the assessment is stamped
  // with the demo clock, which can be fast-forwarded). Requests, bookings and
  // reminders follow, oldest first; one without a time stays after the step before it.
  const start = done.filter((d) => FIRST.has(d.kind));
  let last = "";
  const timed = done
    .filter((d) => !FIRST.has(d.kind))
    .map((item, i) => {
      if (item.at) last = item.at;
      return { item, t: item.at ?? last, i };
    });
  timed.sort((a, b) => (a.t && b.t && a.t !== b.t ? Date.parse(a.t) - Date.parse(b.t) : a.i - b.i));

  const items: TimelineItem[] = [...start, ...timed.map(({ item }) => item)].map((item) => ({ ...item, status: "done" }));
  const reached = new Set(done.map((d) => d.kind));
  const upcoming = ORDER.filter((k) => !reached.has(k) && (k !== "reminded" || reached.has("scheduled")));
  upcoming.forEach((kind, i) => items.push({ key: `next-${kind}`, kind, title: UPCOMING[kind], detail: "", at: null, status: i === 0 ? "next" : "later" }));
  return items;
}
