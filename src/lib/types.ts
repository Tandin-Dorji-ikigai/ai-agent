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
] as const;
export type Sector = (typeof SECTORS)[number];
export const SECTOR_LABEL: Record<Sector, string> = {
  tourism: "Tourism",
  agriculture: "Agriculture",
  handicrafts: "Handicrafts",
  retail: "Retail",
  fintech: "Fintech",
  technology: "Technology",
};

export const EXPERTISE = [
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
  "booking.confirmed",
  "session.completed",
  "action.due_soon",
  "action.overdue",
  "entrepreneur.blocked",
  "escalation.requested",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

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
  sessions_delivered: number;
  verified: boolean;
  active: boolean;
}

/** An entrepreneur (profiles + entrepreneur_profiles). */
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
  confirmed_at: string | null;
  created_at: string;
}
