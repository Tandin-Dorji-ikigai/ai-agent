// The JSON returned by GET /api/state. Shared by server and client code.

import type { ScoreBreakdown } from "./matching/score-mentor";
import type { AgendaItem } from "./progress";
import type { ActionItemRecord, EntrepreneurRecord, MentorRecord, ProgressKind } from "./types";

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

export interface DemoStep {
  n: number;
  label: string;
  done: boolean;
}

export interface DemoState {
  ok: true;
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
  /** Mentor shown in the mentor view: the booked mentor, else the top match. */
  mentor_for_view: MentorRecord | null;
}

export interface ApiError {
  ok: false;
  code: string;
  message: string;
}
