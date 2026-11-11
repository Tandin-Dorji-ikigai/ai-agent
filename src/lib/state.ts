import "server-only";
import { aiMode } from "./agent/ai";
import { apiKey } from "./agent/llm";
import { getDemoClock } from "./clock";
import { loadEntrepreneur, loadMentors } from "./data";
import { DEMO_IDS } from "./demo/ids";
import { MAX_REQUESTS_PER_ROUND, pickNextMentor } from "./matching/requests";
import { rankMentors, scoreMentor, type ScoreBreakdown } from "./matching/score-mentor";
import { buildAgenda } from "./progress";
import { CALL_PROVIDERS } from "./state-types";
import { COACH_STEPS } from "./coach-steps";
import type {
  AgentRunView,
  BookingView,
  CallProvider,
  CoachStepView,
  CoachView,
  CallView,
  DemoState,
  DemoStep,
  EscalationView,
  MatchView,
  MentorRequestView,
  MessageView,
  ProgressView,
  RequestRoundView,
  SessionHistoryItem,
  SessionView,
} from "./state-types";
import { db, must } from "./supabase/server";
import type { ActionItemRecord, MentorRecord, MentorRequestRecord, ProgressUpdateRecord } from "./types";

// Builds the whole demo state in one response. Every number on the YDF
// dashboard comes from these database reads; nothing is invented.

export async function buildDemoState(entrepreneurId: string = DEMO_IDS.pema): Promise<DemoState> {
  const clock = await getDemoClock();
  const [entrepreneur, mentors] = await Promise.all([loadEntrepreneur(entrepreneurId), loadMentors()]);
  const mentorById = new Map(mentors.map((m) => [m.id, m]));

  const base = {
    ok: true as const,
    // "live" only when live AI can actually run (mode on and a key present).
    ai_mode: aiMode() === "live" && apiKey() ? ("live" as const) : ("fixture" as const),
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
      sessions_history: [],
      actions: [],
      messages: [],
      escalations: [],
      runs: [],
      progress: [],
      agenda: [],
      metrics: { credits_used: 0, credits_granted: 0, sessions_completed: 0, actions_completed: 0, actions_total: 0, open_escalations: 0 },
      steps: stepsFor(null),
      request_round: null,
      pending_request: null,
      call: null,
      coach: null,
      mentor_for_view: null,
    };
  }

  const [matchRows, creditRows, bookingRows, actionRows, messageRows, escalationRows, runRows, sessionRows, progressRows, requestRows] = await Promise.all([
    db().from("mentor_matches").select("*").eq("entrepreneur_id", entrepreneurId).order("rank"),
    db().from("sponsorship_credits").select("amount_granted, amount_remaining, status").eq("entrepreneur_id", entrepreneurId),
    db().from("bookings").select("*").eq("entrepreneur_id", entrepreneurId).order("created_at", { ascending: false }).limit(1),
    db().from("action_items").select("*").eq("entrepreneur_id", entrepreneurId).order("due_in_days"),
    db().from("messages").select("*").eq("entrepreneur_id", entrepreneurId).order("created_at"),
    db().from("escalations").select("*, profiles!escalations_entrepreneur_id_fkey(full_name), action_items(title)").order("created_at", { ascending: false }),
    db().from("agent_runs").select("*").order("created_at", { ascending: false }).limit(40),
    db().from("sessions").select("*, bookings!inner(entrepreneur_id, scheduled_at, mentor_id)").eq("bookings.entrepreneur_id", entrepreneurId),
    db().from("progress_updates").select("*").eq("entrepreneur_id", entrepreneurId).order("created_at"),
    db().from("mentor_requests").select("*").eq("entrepreneur_id", entrepreneurId).order("created_at"),
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

  const sessions = must(sessionRows, "load sessions") as Array<
    Omit<SessionView, "transcript_chars"> & {
      bookings: { scheduled_at: string; mentor_id: string };
      transcript: string | null;
      recap?: SessionHistoryItem["recap"];
      recap_source?: SessionHistoryItem["recap_source"];
    }
  >;
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
        notes_source: sessionRow.notes_source ?? "typed",
        transcript_chars: sessionRow.transcript?.length ?? 0,
      }
    : null;

  const sessions_history: SessionHistoryItem[] = sessions
    .filter((s) => s.completed_at)
    .map((s) => ({
      id: s.id,
      booking_id: s.booking_id,
      scheduled_at: s.bookings.scheduled_at,
      completed_at: s.completed_at!,
      mentor_id: s.bookings.mentor_id,
      mentor_name: mentors.find((m) => m.id === s.bookings.mentor_id)?.full_name ?? "Your mentor",
      agent_summary: s.agent_summary,
      recap: s.recap ?? null,
      recap_source: s.recap_source ?? null,
      mentor_notes: s.mentor_notes,
      notes_source: s.notes_source ?? "typed",
      summary_confirmed: s.summary_confirmed,
      transcript_chars: s.transcript?.length ?? 0,
    }))
    .sort((a, b) => b.completed_at.localeCompare(a.completed_at));

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

  // Mentor requests: the agent asks, the mentor decides.
  const requests: MentorRequestView[] = (must(requestRows, "load requests") as MentorRequestRecord[])
    .filter((r) => mentorById.has(r.mentor_id))
    .map((r) => ({
      id: r.id,
      round_id: r.round_id,
      attempt: r.attempt,
      kind: r.kind,
      status: r.status,
      mentor: mentorById.get(r.mentor_id)!,
      score: r.score,
      funding_type: r.funding_type,
      fee: Number(r.fee),
      mentee_summary: r.mentee_summary,
      offered_slots: r.offered_slots ?? [],
      decline_reason: r.decline_reason,
      decline_note: r.decline_note,
      scheduled_at: r.scheduled_at,
      booking_id: r.booking_id,
      expires_at: r.expires_at,
      responded_at: r.responded_at,
      created_at: r.created_at,
    }));
  const pending_request = requests.find((r) => r.status === "pending") ?? null;
  const request_round = roundFor(
    requests,
    escalations,
    entrepreneur.assessment_completed_at ? rankMentors(entrepreneur, mentors) : [],
    entrepreneur.assessment_completed_at,
  );

  const mentor_for_view: MentorRecord | null = pending_request?.mentor ?? booking?.mentor ?? matches[0]?.mentor ?? null;

  const [call, coach] = await Promise.all([booking ? loadCallView(booking.id) : null, loadCoachView(entrepreneurId)]);

  return {
    ...base,
    seeded: true,
    entrepreneur,
    credit: credits.find((c) => c.status === "active") ?? credits[0] ?? null,
    matches,
    most_booked,
    booking,
    session,
    sessions_history,
    actions,
    messages,
    escalations,
    runs,
    progress,
    agenda,
    metrics,
    steps: stepsFor({ entrepreneur, matches, booking, session, actions, runs, requests }),
    request_round,
    pending_request,
    call,
    coach,
    mentor_for_view,
  };
}

async function loadCoachView(entrepreneurId: string): Promise<CoachView | null> {
  const [journeyRes, stepRes] = await Promise.all([
    db().from("coach_journeys").select("status, readiness_summary").eq("entrepreneur_id", entrepreneurId).maybeSingle(),
    db().from("coach_steps").select("*").eq("entrepreneur_id", entrepreneurId).order("step"),
  ]);
  const journey = must(journeyRes, "load coach journey") as { status: CoachView["status"]; readiness_summary: CoachView["summary"] } | null;
  if (!journey) return null;
  const rows = must(stepRes, "load coach steps") as Array<Omit<CoachStepView, "title" | "goal">>;
  return {
    status: journey.status,
    summary: journey.readiness_summary ?? null,
    steps: rows.map((r) => ({
      step: r.step,
      title: COACH_STEPS[r.step - 1]?.title ?? `Step ${r.step}`,
      goal: COACH_STEPS[r.step - 1]?.goal ?? "",
      mission: r.mission,
      why: r.why,
      done_when: r.done_when,
      example: r.example,
      status: r.status,
      attempts: r.attempts,
      last_reply: r.last_reply,
      feedback: r.feedback,
      learnings: r.learnings ?? [],
      source: r.source,
    })),
  };
}

async function loadCallView(bookingId: string): Promise<CallView | null> {
  const row = must(await db().from("calls").select("*").eq("booking_id", bookingId).maybeSingle(), "load call") as Record<string, unknown> | null;
  if (!row) return null;
  const parts = must(await db().from("call_track_parts").select("role").eq("call_id", row.id), "load call parts") as Array<{ role: string }>;
  const count = (role: string) => parts.filter((p) => p.role === role).length;
  return {
    id: String(row.id),
    // Checked, not asserted: anything unexpected reads as "no video".
    provider: (CALL_PROVIDERS as readonly string[]).includes(String(row.provider)) ? (row.provider as CallProvider) : "none",
    status: row.status as CallView["status"],
    joined: { mentor: !!row.mentor_joined_at, entrepreneur: !!row.entrepreneur_joined_at },
    consent: { mentor: !!row.mentor_consent_at, entrepreneur: !!row.entrepreneur_consent_at },
    parts: { mentor: count("mentor"), entrepreneur: count("entrepreneur") },
    done: { mentor: !!row.mentor_done_at, entrepreneur: !!row.entrepreneur_done_at },
    transcript_built: !!row.transcript_built_at,
  };
}

/** The newest round of requests, with what the agent will do next. */
function roundFor(
  requests: MentorRequestView[],
  escalations: EscalationView[],
  ranked: ReturnType<typeof rankMentors>,
  assessedAt: string | null,
): RequestRoundView | null {
  const noMentor = (since: string) =>
    escalations.find((e) => e.reason === "no_mentor_available" && e.status !== "resolved" && Date.parse(e.created_at) >= Date.parse(since)) ?? null;
  const latest = requests.at(-1);
  if (!latest) {
    // Nobody suitable could be asked at all: the agent went straight to YDF.
    const escalation = assessedAt ? noMentor(assessedAt) : null;
    return escalation
      ? { round_id: "none", kind: "match", status: "escalated", requests: [], next_mentor: null, max_requests: MAX_REQUESTS_PER_ROUND, escalation_code: escalation.code }
      : null;
  }
  const inRound = requests.filter((r) => r.round_id === latest.round_id).sort((a, b) => a.attempt - b.attempt);
  const escalation = noMentor(inRound[0].created_at);
  const status: RequestRoundView["status"] = inRound.some((r) => r.status === "accepted")
    ? "accepted"
    : inRound.some((r) => r.status === "pending")
      ? "waiting"
      : escalation
        ? "escalated"
        : inRound[0].kind === "direct" && (inRound.at(-1)!.status === "declined" || inRound.at(-1)!.status === "expired")
          ? "declined"
          : "stopped";
  const canAskMore = status === "waiting" && inRound.length < MAX_REQUESTS_PER_ROUND;
  const next = canAskMore ? pickNextMentor(ranked, inRound.map((r) => r.mentor.id)) : null;
  return {
    round_id: latest.round_id,
    kind: inRound[0].kind,
    status,
    requests: inRound,
    next_mentor: next ? { mentor: next.mentor, score: next.score } : null,
    max_requests: MAX_REQUESTS_PER_ROUND,
    escalation_code: status === "escalated" ? escalation!.code : null,
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
    requests: MentorRequestView[];
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
    (s?.requests.length ?? 0) > 0,
    !!s?.requests.some((r) => r.status === "accepted"),
    s?.booking?.funding_type === "ydf_credit" && (s.booking.status === "confirmed" || s.booking.status === "completed"),
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
    "The agent asks the best-matched mentor",
    "The mentor accepts and picks a time",
    "The platform books it, paid with simulated YDF credit",
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
