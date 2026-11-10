// Validated shapes for (a) API request bodies, (b) AI outputs and (c) tool inputs.
// Live AI output and saved fallbacks must both pass these schemas.

import { z } from "zod";
import { EXPERTISE, LANGUAGES, PROGRESS_KINDS, SECTORS, STAGES } from "../types";

const shortText = (max: number) => z.string().trim().min(1).max(max);

// ---------------------------------------------------------------------------
// API request bodies
// ---------------------------------------------------------------------------

export const AssessmentInputSchema = z.object({
  business_name: shortText(120),
  business_stage: z.enum(STAGES),
  sector: z.enum(SECTORS),
  business_description: shortText(1000),
  primary_challenge: shortText(1000),
  goals: z.array(shortText(200)).max(5).default([]),
  expertise_needs: z.array(z.enum(EXPERTISE)).min(1).max(5),
  languages: z.array(z.enum(LANGUAGES)).min(1),
  preferred_language: z.enum(LANGUAGES),
  budget: z.number().min(0).max(100000),
});
export type AssessmentInput = z.infer<typeof AssessmentInputSchema>;

/**
 * A DRAFT of the needs assessment, understood from a spoken self-introduction.
 * Every field is optional: anything the person did not say stays empty, and the
 * entrepreneur reviews and edits the form before submitting it.
 */
export const AssessmentDraftSchema = z.object({
  business_name: z.string().trim().min(1).max(120).optional(),
  business_stage: z.enum(STAGES).optional(),
  sector: z.enum(SECTORS).optional(),
  business_description: z.string().trim().min(1).max(1000).optional(),
  primary_challenge: z.string().trim().min(1).max(1000).optional(),
  goals: z.array(shortText(200)).max(5).default([]),
  expertise_needs: z.array(z.enum(EXPERTISE)).max(5).default([]),
  languages: z.array(z.enum(LANGUAGES)).max(2).default([]),
  preferred_language: z.enum(LANGUAGES).optional(),
  budget: z.number().min(0).max(100000).optional(),
});
export type AssessmentDraft = z.infer<typeof AssessmentDraftSchema>;

export const AssessmentDraftInputSchema = z.object({
  transcript: shortText(6000),
});

export const BookingInputSchema = z.object({
  mentor_id: z.uuid(),
  funding_type: z.enum(["self_paid", "ydf_credit"]),
  idempotency_key: z.string().min(8).max(100),
});

/** Where a session's text came from (handover contract, see ONBOARDING.md section 9). */
export const NOTES_SOURCES = ["typed", "voice_note", "call_recording"] as const;
export type NotesSource = (typeof NOTES_SOURCES)[number];

/**
 * Longest text the agent reads in one pass on the Groq free tier
 * (8,000 tokens a minute): about 20 to 25 minutes of speech.
 * Longer transcripts are refused with TRANSCRIPT_TOO_LONG until the agent
 * learns to split and summarise them.
 */
export const SINGLE_PASS_MAX_CHARS = 18_000;

/** Hard cap on what the agent accepts (about four hours of speech). */
export const MAX_TRANSCRIPT_CHARS = 200_000;

export const SessionCompleteInputSchema = z
  .object({
    booking_id: z.uuid(),
    /** The mentor's typed or voice-note notes. */
    notes: z.string().trim().max(4000).optional(),
    /** The full call transcript (from the call / audio-to-text work). */
    transcript: z.string().trim().max(MAX_TRANSCRIPT_CHARS).optional(),
    source: z.enum(NOTES_SOURCES).default("typed"),
  })
  .refine((v) => !!v.notes || !!v.transcript, { message: "Send notes, a transcript, or both." });

export const ConfirmActionsInputSchema = z.object({
  session_id: z.uuid(),
  action_ids: z.array(z.uuid()).max(10),
});

export const ActionStatusInputSchema = z.object({
  action_id: z.uuid(),
  status: z.enum(["completed"]),
});

export const InboxReplyInputSchema = z.object({
  message_id: z.uuid(),
  body: shortText(1000),
});

export const FastForwardInputSchema = z.object({
  days: z.number().int().min(1).max(30),
});

export const AgentRunInputSchema = z.object({
  event_id: z.uuid(),
});

// ---------------------------------------------------------------------------
// AI outputs
// ---------------------------------------------------------------------------

export const AssessmentSummarySchema = z.object({
  summary: shortText(600),
});
export type AssessmentSummary = z.infer<typeof AssessmentSummarySchema>;

export const MatchExplanationsSchema = z.object({
  explanations: z
    .array(
      z.object({
        mentor_id: z.uuid(),
        explanation: shortText(450),
      }),
    )
    .min(1)
    .max(3),
});
export type MatchExplanations = z.infer<typeof MatchExplanationsSchema>;

export const BriefsSchema = z.object({
  entrepreneur: z.object({
    headline: shortText(160),
    prepare: z.array(shortText(200)).min(1).max(5),
    questions_to_ask: z.array(shortText(200)).min(1).max(5),
  }),
  mentor: z.object({
    headline: shortText(160),
    about: shortText(600),
    focus: z.array(shortText(200)).min(1).max(5),
  }),
});
export type Briefs = z.infer<typeof BriefsSchema>;

export const ExtractionSchema = z.object({
  summary: shortText(800),
  actions: z
    .array(
      z.object({
        title: shortText(140),
        description: z.string().trim().max(300).optional(),
        /** SMART "measurable": how we will know it is done. */
        success_measure: z.string().trim().max(200).nullable().optional(),
        owner: z.enum(["entrepreneur", "mentor"]),
        due_in_days: z.number().int().min(1).max(60),
      }),
    )
    .max(8),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export const FollowUpSchema = z.object({
  body: shortText(500),
});
export type FollowUp = z.infer<typeof FollowUpSchema>;

/** What the agent keeps from one part of a long call transcript. */
export const ChunkNotesSchema = z.object({
  agreements: z
    .array(
      z.object({
        what: shortText(400),
        who: z.enum(["entrepreneur", "mentor", "unclear"]),
        timeframe: z.string().trim().max(160).optional(),
      }),
    )
    .max(12),
  /** Key facts and decisions, including ideas they decided NOT to pursue. */
  context: z.array(shortText(400)).max(8),
});
export type ChunkNotes = z.infer<typeof ChunkNotesSchema>;

/** How the agent reads a mentee's reply to a check-in ("progress status?"). */
export const ReplyClassificationSchema = z.object({
  status: z.enum(["done", "on_track", "stuck"]),
  needs_help: z.boolean(),
  summary: shortText(300),
});
export type ReplyClassification = z.infer<typeof ReplyClassificationSchema>;

const factors = z.array(shortText(200)).min(1).max(5);

export const DecisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("recommend_resource"),
    resource_id: z.uuid(),
    factors,
  }),
  z.object({
    action: z.literal("suggest_mentor_session"),
    mentor_id: z.uuid(),
    factors,
  }),
  z.object({
    // "Request to human mentor": the mentee's own mentor, added to the next session's agenda.
    action: z.literal("request_mentor_help"),
    mentor_id: z.uuid(),
    factors,
  }),
  z.object({
    action: z.literal("escalate"),
    reason: z.enum(["specialist_required", "safeguarding", "dispute", "other"]),
    priority: z.enum(["low", "medium", "high"]),
    summary: shortText(600),
    factors,
  }),
]);
export type Decision = z.infer<typeof DecisionSchema>;

// ---------------------------------------------------------------------------
// Tool inputs
// ---------------------------------------------------------------------------

export const ToolInputs = {
  get_entrepreneur_context: z.object({ entrepreneur_id: z.uuid() }),
  find_matching_mentors: z.object({
    entrepreneur_id: z.uuid(),
    limit: z.number().int().min(1).max(5).default(3),
  }),
  create_booking_request: z.object({
    entrepreneur_id: z.uuid(),
    mentor_id: z.uuid(),
    funding_type: z.enum(["self_paid", "ydf_credit"]),
    idempotency_key: z.string().min(8).max(100),
  }),
  create_session_brief: z.object({ booking_id: z.uuid() }),
  extract_action_items: z.object({
    session_id: z.uuid(),
    notes: z.string().trim().min(1).max(MAX_TRANSCRIPT_CHARS + 4100),
    source: z.enum(NOTES_SOURCES).default("typed"),
  }),
  update_action_status: z.object({
    entrepreneur_id: z.uuid(),
    action_id: z.uuid(),
    status: z.enum(["pending", "completed", "blocked", "overdue"]),
    blocker: z.string().trim().max(1000).optional(),
  }),
  recommend_approved_resource: z.object({
    entrepreneur_id: z.uuid(),
    resource_id: z.uuid(),
    action_id: z.uuid().optional(),
  }),
  suggest_mentor_session: z.object({
    entrepreneur_id: z.uuid(),
    mentor_id: z.uuid(),
    action_id: z.uuid().optional(),
  }),
  create_escalation: z.object({
    entrepreneur_id: z.uuid(),
    action_item_id: z.uuid().optional(),
    session_id: z.uuid().optional(),
    reason: z.enum(["specialist_required", "safeguarding", "dispute", "other"]),
    summary: shortText(600),
    priority: z.enum(["low", "medium", "high"]),
  }),
  send_inbox_message: z.object({
    entrepreneur_id: z.uuid(),
    kind: z.enum(["info", "follow_up", "check_in", "recommendation", "escalation_notice"]),
    body: shortText(800),
    body_dz: z.string().max(800).nullable().optional(),
    dz_verified: z.boolean().optional(),
    related_action_id: z.uuid().optional(),
    awaiting_reply: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    source: z.enum(["live_ai", "fallback", "human", "system"]),
  }),
  record_progress: z.object({
    entrepreneur_id: z.uuid(),
    action_id: z.uuid(),
    kind: z.enum(PROGRESS_KINDS),
    note: z.string().trim().max(600).optional(),
    agenda: z.boolean().default(false),
    source: z.enum(["live_ai", "fallback", "human", "system"]),
  }),
  schedule_check_in: z.object({
    entrepreneur_id: z.uuid(),
    action_id: z.uuid(),
    in_days: z.number().int().min(1).max(14),
  }),
  request_mentor_help: z.object({
    entrepreneur_id: z.uuid(),
    mentor_id: z.uuid(),
    action_id: z.uuid(),
    summary: shortText(600),
  }),
} as const;

export type ToolName = keyof typeof ToolInputs;
