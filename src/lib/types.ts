// Shared domain vocabulary and record shapes.
// Kept dependency-free so it can be imported by server code, client code and tests.

export const LANGUAGES = ["dz", "en"] as const;
export type Language = (typeof LANGUAGES)[number];
export const LANGUAGE_LABEL: Record<Language, string> = {
  dz: "Dzongkha",
  en: "English",
};

export const STAGES = ["idea", "early", "growth", "established"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  idea: "Idea",
  early: "Early stage",
  growth: "Growth",
  established: "Established",
};

export const SECTORS = [
  "tourism",
  "agriculture",
  "handicrafts",
  "retail",
  "fintech",
  "technology",
  /** Aspiring entrepreneurs who have not chosen an area yet. */
  "undecided",
] as const;
export type Sector = (typeof SECTORS)[number];
export const SECTOR_LABEL: Record<Sector, string> = {
  tourism: "Tourism",
  agriculture: "Agriculture",
  handicrafts: "Handicrafts",
  retail: "Retail",
  fintech: "Fintech",
  technology: "Technology",
  undecided: "Not decided yet",
};

export const EXPERTISE = [
  "idea_development",
  "customer_validation",
  "market_positioning",
  "pricing",
  "community_tourism",
  "operations",
  "hospitality_management",
  "accounting",
  "financial_planning",
  "tax",
  "fundraising",
  "digital_payments",
  "growth_marketing",
  "branding",
  "social_media",
  "product_development",
  "user_research",
  "supply_chain",
  "team_building",
  "regulatory_compliance",
  "business_registration",
] as const;
export type Expertise = (typeof EXPERTISE)[number];
export const EXPERTISE_LABEL: Record<Expertise, string> = {
  idea_development: "Finding and testing a business idea",
  customer_validation: "Customer validation",
  market_positioning: "Market positioning",
  pricing: "Pricing",
  community_tourism: "Community tourism",
  operations: "Operations",
  hospitality_management: "Hospitality management",
  accounting: "Accounting",
  financial_planning: "Financial planning",
  tax: "Tax",
  fundraising: "Fundraising",
  digital_payments: "Digital payments",
  growth_marketing: "Growth marketing",
  branding: "Branding",
  social_media: "Social media",
  product_development: "Product development",
  user_research: "User research",
  supply_chain: "Supply chain",
  team_building: "Team building",
  regulatory_compliance: "Regulatory compliance and permits",
  business_registration: "Business registration",
};

export function expertiseLabel(key: string): string {
  return (EXPERTISE_LABEL as Record<string, string>)[key] ?? key;
}
export function sectorLabel(key: string | null | undefined): string {
  if (!key) return "";
  return (SECTOR_LABEL as Record<string, string>)[key] ?? key;
}
export function stageLabel(key: string | null | undefined): string {
  if (!key) return "";
  return (STAGE_LABEL as Record<string, string>)[key] ?? key;
}

export type FundingType = "self_paid" | "ydf_credit";
export type ActionStatus = "draft" | "pending" | "completed" | "blocked" | "overdue";
export type ResultSource = "live_ai" | "fallback";

export const EVENT_TYPES = [
  "assessment.completed",
  "mentor.match.requested",
  "mentor.selected",
  "mentor.request.declined",
  "mentor.request.expired",
  "booking.confirmed",
  "session.completed",
  "action.due_soon",
  "action.overdue",
  "entrepreneur.blocked",
  "checkin.replied",
  "escalation.requested",
  "coach.started",
  "coach.replied",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** A time a mentor is usually free each week, in Bhutan time (UTC+6). */
export interface WeeklySlot {
  day: Weekday;
  /** "HH:MM", 24-hour clock. */
  time: string;
}

/** A mentor as the matching engine and the UI see it (profiles + mentor_profiles). */
export interface MentorRecord {
  id: string;
  full_name: string;
  location: string | null;
  headline: string | null;
  bio: string | null;
  expertise: string[];
  sectors: string[];
  business_stages: string[];
  languages: Language[];
  fee: number;
  slots_remaining: number;
  availability_summary: string | null;
  /** When the mentor is usually free; requests offer the next of these times. */
  weekly_slots: WeeklySlot[];
  sessions_delivered: number;
  verified: boolean;
  active: boolean;
}

/** An entrepreneur (profiles + entrepreneur_profiles). */
/** Needs assessment extras (optional): when they hope to get there, and how they want to meet. */
export const TIMEFRAMES = ["1 month", "3 months", "6 months", "12 months", "Flexible"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];
export const MENTORING_FORMATS = ["either", "online", "in_person"] as const;
export type MentoringFormat = (typeof MENTORING_FORMATS)[number];
export const MENTORING_FORMAT_LABEL: Record<MentoringFormat, string> = {
  either: "Online or in-person",
  online: "Online only",
  in_person: "In-person only",
};

export interface EntrepreneurRecord {
  id: string;
  full_name: string;
  location: string | null;
  preferred_language: Language;
  languages: Language[];
  business_name: string | null;
  business_stage: Stage | null;
  sector: string | null;
  business_description: string | null;
  primary_challenge: string | null;
  goals: string[];
  expertise_needs: string[];
  budget: number;
  /** What they have done or have ready so far, in their words. */
  progress_so_far: string | null;
  /** How they want the finished product or service to work. */
  vision: string | null;
  timeframe: Timeframe | null;
  mentoring_format: MentoringFormat | null;
  assessment_summary: string | null;
  assessment_completed_at: string | null;
}

export interface ResourceRecord {
  id: string;
  slug: string;
  title: string;
  summary: string;
  topics: string[];
  sectors: string[];
  format: string | null;
  approved: boolean;
}

export interface ActionItemRecord {
  id: string;
  session_id: string;
  entrepreneur_id: string;
  title: string;
  description: string | null;
  owner: "entrepreneur" | "mentor";
  due_in_days: number;
  due_at: string | null;
  status: ActionStatus;
  blocker: string | null;
  /** SMART "measurable": how we will know it is done. */
  success_measure: string | null;
  next_check_in_at: string | null;
  last_check_in_at: string | null;
  confirmed_at: string | null;
  created_at: string;
}

export const PROGRESS_KINDS = [
  "on_track",
  "done",
  "obstacle",
  "help_requested",
  "resource_recommended",
  "mentor_requested",
  "mentor_session_suggested",
  "escalated",
] as const;
export type ProgressKind = (typeof PROGRESS_KINDS)[number];

/** One entry in the mentor's progress feed ("add to mentor progress"). */
export interface ProgressUpdateRecord {
  id: string;
  entrepreneur_id: string;
  action_item_id: string | null;
  kind: ProgressKind;
  note: string | null;
  /** true = carried into the next session's agenda */
  agenda: boolean;
  source: "live_ai" | "fallback" | "human" | "system" | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Mentor requests: the agent asks a mentor, the mentor decides.
// ---------------------------------------------------------------------------

export const DECLINE_REASONS = ["no_time", "not_my_area", "other"] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];
export const DECLINE_REASON_LABEL: Record<DeclineReason, string> = {
  no_time: "No time this week",
  not_my_area: "Not my area",
  other: "Another reason",
};

export type RequestStatus = "pending" | "accepted" | "declined" | "expired" | "cancelled";

/** What a mentor sees in a request: need-to-know only (no phone, no budget). */
export interface MenteeSummary {
  full_name: string;
  location: string | null;
  business_name: string | null;
  business_stage: Stage | null;
  sector: string | null;
  needs: string[];
  challenge: string | null;
  preferred_language: Language;
  /** Optional extras from the needs assessment (absent on requests sent before they existed). */
  progress_so_far?: string | null;
  timeframe?: Timeframe | null;
  mentoring_format?: MentoringFormat | null;
  /** Plain facts from the score: why the agent picked this mentor. */
  why: string[];
  /** true when the mentee has had a session with this mentor before. */
  follow_up: boolean;
}

export interface MentorRequestRecord {
  id: string;
  entrepreneur_id: string;
  mentor_id: string;
  round_id: string;
  attempt: number;
  kind: "match" | "direct";
  score: number | null;
  funding_type: FundingType;
  fee: number;
  mentee_summary: MenteeSummary;
  offered_slots: string[];
  status: RequestStatus;
  decline_reason: DeclineReason | null;
  decline_note: string | null;
  scheduled_at: string | null;
  booking_id: string | null;
  expires_at: string;
  responded_at: string | null;
  created_at: string;
}
