// The JSON returned by GET /api/state. Shared by server and client code.

import type { ViewerRole } from "./access";
import type { ScoreBreakdown } from "./matching/score-mentor";
import type { AgendaItem } from "./progress";
import type {
  ActionItemRecord,
  DeclineReason,
  EntrepreneurRecord,
  FundingType,
  MenteeSummary,
  MentorRecord,
  ProgressKind,
  RequestStatus,
} from "./types";

export type { AgendaItem };

/** One entry in the mentor's progress feed. */
export interface ProgressView {
  id: string;
  action_item_id: string | null;
  action_title: string | null;
  kind: ProgressKind;
  note: string | null;
  agenda: boolean;
  source: "live_ai" | "fallback" | "human" | "system" | null;
  created_at: string;
}

export interface MatchView {
  rank: number;
  score: number;
  breakdown: ScoreBreakdown;
  explanation: string | null;
  explanation_source: "live_ai" | "fallback" | null;
  mentor: MentorRecord;
}

export interface EntrepreneurBrief {
  headline: string;
  prepare: string[];
  questions_to_ask: string[];
}

export interface MentorBrief {
  headline: string;
  about: string;
  focus: string[];
}

export interface BookingView {
  id: string;
  mentor: MentorRecord;
  scheduled_at: string;
  fee: number;
  funding_type: "self_paid" | "ydf_credit";
  status: string;
  entrepreneur_brief: EntrepreneurBrief | null;
  mentor_brief: MentorBrief | null;
  brief_source: "live_ai" | "fallback" | null;
  idempotency_key: string;
}

export interface SessionView {
  id: string;
  booking_id: string;
  mentor_notes: string | null;
  agent_summary: string | null;
  summary_source: "live_ai" | "fallback" | null;
  summary_confirmed: boolean;
  completed_at: string | null;
  /** Where the session text came from (handover contract). */
  notes_source: "typed" | "voice_note" | "call_recording";
  /** Length of the stored call transcript, 0 if none (the text itself is not sent to the browser). */
  transcript_chars: number;
}

export interface MessageView {
  id: string;
  sender: "agent" | "entrepreneur" | "mentor" | "ydf";
  kind: "info" | "follow_up" | "check_in" | "reply" | "recommendation" | "escalation_notice";
  body: string;
  body_dz: string | null;
  dz_verified: boolean;
  related_action_id: string | null;
  awaiting_reply: boolean;
  metadata: Record<string, unknown>;
  source: "live_ai" | "fallback" | "human" | "system" | null;
  created_at: string;
}

export interface EscalationView {
  id: string;
  code: string;
  entrepreneur_name: string;
  action_title: string | null;
  reason: string;
  summary: string;
  priority: "low" | "medium" | "high";
  status: "open" | "assigned" | "resolved";
  created_at: string;
}

export interface ToolCallView {
  tool: string;
  input: Record<string, unknown>;
  ok: boolean;
  summary: string;
}

export interface AgentRunView {
  id: string;
  trigger: string;
  input_summary: string | null;
  tools_called: ToolCallView[];
  decision: string | null;
  decision_factors: string[];
  final_output: string | null;
  source: "live_ai" | "fallback" | null;
  status: "running" | "completed" | "failed";
  error: string | null;
  event_id: string | null;
  created_at: string;
}

/** A request the agent sent to one mentor. */
export interface MentorRequestView {
  id: string;
  round_id: string;
  attempt: number;
  kind: "match" | "direct";
  status: RequestStatus;
  mentor: MentorRecord;
  score: number | null;
  funding_type: FundingType;
  fee: number;
  /** What the mentor sees about the mentee. */
  mentee_summary: MenteeSummary;
  /** Times the mentor can pick from (ISO, UTC). */
  offered_slots: string[];
  decline_reason: DeclineReason | null;
  /** The mentor's own words; shown to the mentor and YDF, not the mentee. */
  decline_note: string | null;
  scheduled_at: string | null;
  booking_id: string | null;
  expires_at: string;
  responded_at: string | null;
  created_at: string;
}

/** The agent's current attempt to find the mentee a mentor. */
export interface RequestRoundView {
  round_id: string;
  kind: "match" | "direct";
  /** waiting: a mentor is deciding. accepted: booked. escalated: handed to YDF. stopped: closed without a booking. */
  status: "waiting" | "accepted" | "escalated" | "stopped";
  /** Oldest first. */
  requests: MentorRequestView[];
  /** Who the agent will ask if the current mentor says no (null after the last allowed request). */
  next_mentor: { mentor: MentorRecord; score: number } | null;
  /** Requests the agent may still send before it hands over to YDF. */
  max_requests: number;
  escalation_code: string | null;
}

/** The call for the current booking (join links are personal and never part of the shared state). */
export interface CallView {
  id: string;
  provider: "daily" | "none";
  status: "open" | "ended";
  joined: { mentor: boolean; entrepreneur: boolean };
  /** Recording needs both. */
  consent: { mentor: boolean; entrepreneur: boolean };
  /** Parts uploaded per person (each about 3 minutes of their own microphone). */
  parts: { mentor: number; entrepreneur: number };
  /** Each person said they have finished. */
  done: { mentor: boolean; entrepreneur: boolean };
  /** The merged transcript has gone to the agent. */
  transcript_built: boolean;
}

export interface DemoStep {
  n: number;
  label: string;
  done: boolean;
}

export interface DemoState {
  ok: true;
  /** Who this device is signed in as. role "team" with signed_in false = sign-in is off (local development). */
  viewer?: { role: ViewerRole; signed_in: boolean } | null;
  seeded: boolean;
  ai_mode: "fixture" | "live";
  clock: { now: string; offset_days: number };
  entrepreneur: EntrepreneurRecord | null;
  credit: { amount_granted: number; amount_remaining: number; status: string } | null;
  matches: MatchView[];
  most_booked: { mentor: MentorRecord; score: number; rank: number | null; eligible_count: number } | null;
  booking: BookingView | null;
  session: SessionView | null;
  actions: ActionItemRecord[];
  messages: MessageView[];
  escalations: EscalationView[];
  runs: AgentRunView[];
  /** "Add to mentor progress": every reply outcome, newest last. */
  progress: ProgressView[];
  /** What the mentor should cover in the next session. */
  agenda: AgendaItem[];
  metrics: {
    credits_used: number;
    credits_granted: number;
    sessions_completed: number;
    actions_completed: number;
    actions_total: number;
    open_escalations: number;
  };
  steps: DemoStep[];
  /** The agent's current round of mentor requests (null before matching). */
  request_round: RequestRoundView | null;
  /** The call for the current booking, if anyone has joined it. */
  call: CallView | null;
  /** The open request, if a mentor is deciding right now. */
  pending_request: MentorRequestView | null;
  /** Mentor shown in the mentor view: the one deciding on a request, else the booked mentor, else the top match. */
  mentor_for_view: MentorRecord | null;
}

export interface ApiError {
  ok: false;
  code: string;
  message: string;
}
