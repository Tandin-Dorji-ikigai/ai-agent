import "server-only";
import { aiMode } from "./agent/ai";
import { getDemoClock } from "./clock";
import { loadEntrepreneur, loadMentors } from "./data";
import { DEMO_IDS } from "./demo/ids";
import { rankMentors, scoreMentor, type ScoreBreakdown } from "./matching/score-mentor";
import { buildAgenda } from "./progress";
import type {
  AgentRunView,
  BookingView,
  DemoState,
  DemoStep,
  EscalationView,
  MatchView,
  MessageView,
  ProgressView,
  SessionView,
} from "./state-types";
import { db, must } from "./supabase/server";
import type { ActionItemRecord, MentorRecord, ProgressUpdateRecord } from "./types";

// Builds the whole demo state in one response. Every number on the YDF
// dashboard comes from these database reads; nothing is invented.

export async function buildDemoState(entrepreneurId: string = DEMO_IDS.pema): Promise<DemoState> {
  const clock = await getDemoClock();
  const [entrepreneur, mentors] = await Promise.all([loadEntrepreneur(entrepreneurId), loadMentors()]);
  const mentorById = new Map(mentors.map((m) => [m.id, m]));

  const base = {
    ok: true as const,
    ai_mode: aiMode(),
    clock: { now: clock.now.toISOString(), offset_days: clock.offsetDays },
  };

  if (!entrepreneur) {
    return {
      ...base,
      seeded: false,
      entrepreneur: null,
      credit: null,
      matches: [],
      most_booked: null,
      booking: null,
      session: null,
      actions: [],
      messages: [],
      escalations: [],
      runs: [],
      progress: [],
      agenda: [],
      metrics: { credits_used: 0, credits_granted: 0, sessions_completed: 0, actions_completed: 0, actions_total: 0, open_escalations: 0 },
      steps: stepsFor(null),
      mentor_for_view: null,
    };
  }

  const [matchRows, creditRows, bookingRows, actionRows, messageRows, escalationRows, runRows, sessionRows, progressRows] = await Promise.all([
    db().from("mentor_matches").select("*").eq("entrepreneur_id", entrepreneurId).order("rank"),
    db().from("sponsorship_credits").select("amount_granted, amount_remaining, status").eq("entrepreneur_id", entrepreneurId),
    db().from("bookings").select("*").eq("entrepreneur_id", entrepreneurId).order("created_at", { ascending: false }).limit(1),
    db().from("action_items").select("*").eq("entrepreneur_id", entrepreneurId).order("due_in_days"),
    db().from("messages").select("*").eq("entrepreneur_id", entrepreneurId).order("created_at"),
    db().from("escalations").select("*, profiles!escalations_entrepreneur_id_fkey(full_name), action_items(title)").order("created_at", { ascending: false }),
    db().from("agent_runs").select("*").order("created_at", { ascending: false }).limit(40),
    db().from("sessions").select("*, bookings!inner(entrepreneur_id)").eq("bookings.entrepreneur_id", entrepreneurId),
    db().from("progress_updates").select("*").eq("entrepreneur_id", entrepreneurId).order("created_at"),
  ]);

  const matches: MatchView[] = (must(matchRows, "load matches") as Array<{
    rank: number;
    score: number;
    score_breakdown: ScoreBreakdown;
    explanation: string | null;
    explanation_source: "live_ai" | "fallback" | null;
    mentor_id: string;
  }>)
    .filter((r) => mentorById.has(r.mentor_id))
    .map((r) => ({
      rank: r.rank,
      score: r.score,
      breakdown: r.score_breakdown,
      explanation: r.explanation,
      explanation_source: r.explanation_source,
      mentor: mentorById.get(r.mentor_id)!,
    }));

  const credits = (must(creditRows, "load credits") as Array<{ amount_granted: number; amount_remaining: number; status: string }>).map((c) => ({
    amount_granted: Number(c.amount_granted),
    amount_remaining: Number(c.amount_remaining),
    status: c.status,
  }));

  const bookingRow = (must(bookingRows, "load booking") as Array<Record<string, unknown>>)[0];
  const booking: BookingView | null =
    bookingRow && mentorById.has(String(bookingRow.mentor_id))
      ? {
          id: String(bookingRow.id),
          mentor: mentorById.get(String(bookingRow.mentor_id))!,
          scheduled_at: String(bookingRow.scheduled_at),
          fee: Number(bookingRow.fee),
          funding_type: bookingRow.funding_type as BookingView["funding_type"],
          status: String(bookingRow.status),
          entrepreneur_brief: (bookingRow.entrepreneur_brief as BookingView["entrepreneur_brief"]) ?? null,
          mentor_brief: (bookingRow.mentor_brief as BookingView["mentor_brief"]) ?? null,
          brief_source: (bookingRow.brief_source as BookingView["brief_source"]) ?? null,
          idempotency_key: String(bookingRow.idempotency_key),
        }
      : null;

  const sessions = must(sessionRows, "load sessions") as Array<SessionView & { bookings: unknown }>;
  const sessionRow = booking ? sessions.find((s) => s.booking_id === booking.id) : undefined;
  const session: SessionView | null = sessionRow
    ? {
        id: sessionRow.id,
        booking_id: sessionRow.booking_id,
        mentor_notes: sessionRow.mentor_notes,
        agent_summary: sessionRow.agent_summary,
        summary_source: sessionRow.summary_source,
        summary_confirmed: sessionRow.summary_confirmed,
        completed_at: sessionRow.completed_at,
      }
    : null;

  const actions = must(actionRows, "load actions") as ActionItemRecord[];
  const messages = must(messageRows, "load messages") as MessageView[];

  const escalations: EscalationView[] = (must(escalationRows, "load escalations") as Array<{
    id: string;
    code: string;
    reason: string;
    summary: string;
    priority: EscalationView["priority"];
    status: EscalationView["status"];
    created_at: string;
    profiles: { full_name: string } | null;
    action_items: { title: string } | null;
  }>).map((e) => ({
    id: e.id,
    code: e.code,
    entrepreneur_name: e.profiles?.full_name ?? "Unknown",
    action_title: e.action_items?.title ?? null,
    reason: e.reason,
    summary: e.summary,
    priority: e.priority,
    status: e.status,
    created_at: e.created_at,
  }));

  const runs = must(runRows, "load runs") as AgentRunView[];

  const updates = must(progressRows, "load progress") as ProgressUpdateRecord[];
  const progress: ProgressView[] = updates.map((u) => ({
    id: u.id,
    action_item_id: u.action_item_id,
    action_title: actions.find((a) => a.id === u.action_item_id)?.title ?? null,
    kind: u.kind,
    note: u.note,
    agenda: u.agenda,
    source: u.source,
    created_at: u.created_at,
  }));
  const agenda = buildAgenda({
    entrepreneurFirstName: entrepreneur.full_name.split(" ")[0],
    actions,
    updates,
    escalations: escalations.map((e) => ({
      code: e.code,
      status: e.status,
      action_item_id: actions.find((a) => a.title === e.action_title)?.id ?? null,
    })),
  });

  // "Right mentor, not the most visible one": where does the most-booked mentor rank?
  let most_booked: DemoState["most_booked"] = null;
  if (entrepreneur.assessment_completed_at && mentors.length > 0) {
    const popular = [...mentors].sort((a, b) => b.sessions_delivered - a.sessions_delivered)[0];
    const ranked = rankMentors(entrepreneur, mentors);
    const idx = ranked.findIndex((r) => r.mentor.id === popular.id);
    most_booked = {
      mentor: popular,
      score: scoreMentor(entrepreneur, popular).score,
      rank: idx >= 0 ? idx + 1 : null,
      eligible_count: ranked.length,
    };
  }

  const confirmed = actions.filter((a) => a.status !== "draft");
  const metrics = {
    credits_granted: credits.reduce((s, c) => s + c.amount_granted, 0),
    credits_used: credits.reduce((s, c) => s + (c.amount_granted - c.amount_remaining), 0),
    sessions_completed: sessions.filter((s) => s.completed_at).length,
    actions_completed: confirmed.filter((a) => a.status === "completed").length,
    actions_total: confirmed.length,
    open_escalations: escalations.filter((e) => e.status !== "resolved").length,
  };

  const mentor_for_view: MentorRecord | null = booking?.mentor ?? matches[0]?.mentor ?? null;

  return {
    ...base,
    seeded: true,
    entrepreneur,
    credit: credits.find((c) => c.status === "active") ?? credits[0] ?? null,
    matches,
    most_booked,
    booking,
    session,
    actions,
    messages,
    escalations,
    runs,
    progress,
    agenda,
    metrics,
    steps: stepsFor({ entrepreneur, matches, booking, session, actions, runs }),
    mentor_for_view,
  };
}

/** Step 13 is the "stuck, needs help" branch of the check-in loop. */
const HELP_DECISIONS = new Set([
  "Recommend an approved resource",
  "Ask the mentor for help",
  "Suggest another mentor session",
  "Escalate to YDF",
]);

function stepsFor(
  s: {
    entrepreneur: { assessment_completed_at: string | null };
    matches: MatchView[];
    booking: BookingView | null;
    session: SessionView | null;
    actions: ActionItemRecord[];
    runs: AgentRunView[];
  } | null,
): DemoStep[] {
  const decided = !!s?.runs.some(
    (r) =>
      (r.trigger === "checkin.replied" || r.trigger === "entrepreneur.blocked") &&
      r.status === "completed" &&
      r.decision !== null &&
      HELP_DECISIONS.has(r.decision),
  );
  const done = [
    !!s?.entrepreneur.assessment_completed_at,
    (s?.matches.length ?? 0) > 0,
    (s?.matches.length ?? 0) === 3,
    !!s && s.matches.length > 0 && s.matches.every((m) => !!m.explanation),
    !!s?.booking,
    s?.booking?.funding_type === "ydf_credit",
    s?.booking?.status === "confirmed" || s?.booking?.status === "completed",
    !!s?.booking?.entrepreneur_brief && !!s?.booking?.mentor_brief,
    !!s?.session?.completed_at,
    (s?.actions.length ?? 0) > 0,
    !!s?.session?.summary_confirmed,
    !!s?.actions.some((a) => a.status === "overdue" || a.status === "blocked"),
    decided,
    decided,
  ];
  const labels = [
    "Pema submits a needs assessment",
    "The backend calculates mentor scores",
    "The system returns three verified mentors",
    "Each match is explained from supplied evidence only",
    "Pema selects a mentor",
    "Pema selects simulated YDF sponsorship",
    "The platform creates a simulated booking",
    "The agent produces entrepreneur and mentor briefs",
    "The mentor submits quick session notes",
    "The agent extracts draft action items",
    "A human confirms the action items",
    "Fast-forward: check-ins go out and one action is overdue",
    "The agent reads Pema's reply and chooses the help she needs",
    "The YDF dashboard shows the outcome",
  ];
  return labels.map((label, i) => ({ n: i + 1, label, done: done[i] }));
}
