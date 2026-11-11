import "server-only";
import { db, must } from "./supabase/server";
import type {
  ActionItemRecord,
  EntrepreneurRecord,
  Language,
  MentorRecord,
  ResourceRecord,
  Stage,
  WeeklySlot,
} from "./types";

// Read helpers that turn database rows into the shapes the agent and UI use.

interface ProfileRow {
  id: string;
  full_name: string;
  location: string | null;
  preferred_language: Language;
}

interface MentorRow {
  user_id: string;
  headline: string | null;
  bio: string | null;
  expertise: string[];
  sectors: string[];
  business_stages: string[];
  languages: Language[];
  fee: number | string;
  slots_remaining: number;
  availability_summary: string | null;
  weekly_slots: WeeklySlot[] | null;
  sessions_delivered: number;
  verified: boolean;
  active: boolean;
  profiles: ProfileRow;
}

function toMentor(row: MentorRow): MentorRecord {
  return {
    id: row.user_id,
    full_name: row.profiles.full_name,
    location: row.profiles.location,
    headline: row.headline,
    bio: row.bio,
    expertise: row.expertise ?? [],
    sectors: row.sectors ?? [],
    business_stages: row.business_stages ?? [],
    languages: row.languages ?? [],
    fee: Number(row.fee),
    slots_remaining: row.slots_remaining,
    availability_summary: row.availability_summary,
    weekly_slots: row.weekly_slots ?? [],
    sessions_delivered: row.sessions_delivered,
    verified: row.verified,
    active: row.active,
  };
}

const MENTOR_SELECT = "*, profiles!inner(id, full_name, location, preferred_language)";

export async function loadMentors(): Promise<MentorRecord[]> {
  const rows = must(await db().from("mentor_profiles").select(MENTOR_SELECT), "load mentors") as MentorRow[];
  return rows.map(toMentor);
}

export async function loadMentor(id: string): Promise<MentorRecord | null> {
  const row = must(
    await db().from("mentor_profiles").select(MENTOR_SELECT).eq("user_id", id).maybeSingle(),
    "load mentor",
  ) as MentorRow | null;
  return row ? toMentor(row) : null;
}

interface EntrepreneurRow {
  user_id: string;
  business_name: string | null;
  business_stage: Stage | null;
  sector: string | null;
  business_description: string | null;
  primary_challenge: string | null;
  goals: string[];
  expertise_needs: string[];
  languages: Language[];
  budget: number | string;
  progress_so_far: string | null;
  vision: string | null;
  timeframe: EntrepreneurRecord["timeframe"];
  mentoring_format: EntrepreneurRecord["mentoring_format"];
  assessment_summary: string | null;
  assessment_completed_at: string | null;
  profiles: ProfileRow;
}

export async function loadEntrepreneur(id: string): Promise<EntrepreneurRecord | null> {
  const row = (await db()
    .from("entrepreneur_profiles")
    .select("*, profiles!inner(id, full_name, location, preferred_language)")
    .eq("user_id", id)
    .maybeSingle()
    .then((r) => must(r, "load entrepreneur"))) as EntrepreneurRow | null;
  if (!row) return null;
  return {
    id: row.user_id,
    full_name: row.profiles.full_name,
    location: row.profiles.location,
    preferred_language: row.profiles.preferred_language,
    languages: row.languages ?? [],
    business_name: row.business_name,
    business_stage: row.business_stage,
    sector: row.sector,
    business_description: row.business_description,
    primary_challenge: row.primary_challenge,
    goals: row.goals ?? [],
    expertise_needs: row.expertise_needs ?? [],
    budget: Number(row.budget),
    progress_so_far: row.progress_so_far ?? null,
    vision: row.vision ?? null,
    timeframe: row.timeframe ?? null,
    mentoring_format: row.mentoring_format ?? null,
    assessment_summary: row.assessment_summary,
    assessment_completed_at: row.assessment_completed_at,
  };
}

export async function loadResources(): Promise<ResourceRecord[]> {
  return must(await db().from("resources").select("*"), "load resources") as ResourceRecord[];
}

export async function loadActionItem(id: string): Promise<ActionItemRecord | null> {
  return must(
    await db().from("action_items").select("*").eq("id", id).maybeSingle(),
    "load action item",
  ) as ActionItemRecord | null;
}
