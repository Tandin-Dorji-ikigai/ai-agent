// Deterministic mentor scoring (CLAUDE_WORKING_PLAN.md, "Mentor scoring").
// The AI never ranks mentors. It only explains the breakdown produced here.

import type { MentorRecord } from "../types";

export const WEIGHTS = {
  expertise: 35,
  sector: 20,
  business_stage: 15,
  language: 10,
  availability: 10,
  budget: 10,
} as const;

export type ScoreFactor = keyof typeof WEIGHTS;
export type ScoreBreakdown = Record<ScoreFactor, number>;

/** The entrepreneur fields scoring depends on. */
export interface MatchInput {
  sector: string | null;
  business_stage: string | null;
  preferred_language: string;
  languages: string[];
  expertise_needs: string[];
  budget: number;
}

export interface ScoredMentor {
  mentor: MentorRecord;
  score: number;
  breakdown: ScoreBreakdown;
  /** Which of the entrepreneur's needs this mentor covers. */
  matched_expertise: string[];
}

/** Expertise: proportional to how many of the entrepreneur's needs are covered. */
function expertisePoints(needs: string[], mentorExpertise: string[]): { points: number; matched: string[] } {
  const unique = [...new Set(needs)];
  if (unique.length === 0) return { points: 0, matched: [] };
  const matched = unique.filter((n) => mentorExpertise.includes(n));
  return { points: Math.round((WEIGHTS.expertise * matched.length) / unique.length), matched };
}

/** Language: full points for the preferred language, half for another shared language. */
function languagePoints(input: MatchInput, mentor: MentorRecord): number {
  const spoken: string[] = mentor.languages;
  if (spoken.includes(input.preferred_language)) return WEIGHTS.language;
  if (input.languages.some((l) => spoken.includes(l))) return WEIGHTS.language / 2;
  return 0;
}

/** Availability: 2+ open slots = full, 1 slot = half, fully booked = 0. */
function availabilityPoints(mentor: MentorRecord): number {
  if (mentor.slots_remaining >= 2) return WEIGHTS.availability;
  if (mentor.slots_remaining === 1) return WEIGHTS.availability / 2;
  return 0;
}

/** Budget: within budget = full, up to 50% over = half, more = 0. */
function budgetPoints(budget: number, fee: number): number {
  if (fee <= budget) return WEIGHTS.budget;
  if (fee <= budget * 1.5) return WEIGHTS.budget / 2;
  return 0;
}

export function scoreMentor(input: MatchInput, mentor: MentorRecord): ScoredMentor {
  const expertise = expertisePoints(input.expertise_needs, mentor.expertise);
  const breakdown: ScoreBreakdown = {
    expertise: expertise.points,
    sector: input.sector && mentor.sectors.includes(input.sector) ? WEIGHTS.sector : 0,
    business_stage:
      input.business_stage && mentor.business_stages.includes(input.business_stage) ? WEIGHTS.business_stage : 0,
    language: languagePoints(input, mentor),
    availability: availabilityPoints(mentor),
    budget: budgetPoints(input.budget, mentor.fee),
  };
  const score = Object.values(breakdown).reduce((sum, n) => sum + n, 0);
  return { mentor, score, breakdown, matched_expertise: expertise.matched };
}

/** Only verified, active mentors may ever be recommended. */
export function isEligible(mentor: MentorRecord): boolean {
  return mentor.verified && mentor.active;
}

/**
 * Ranks eligible mentors. Ties are broken deterministically:
 * score (high first), then open slots (spreads load away from busy mentors),
 * then fee (low first), then id.
 */
export function rankMentors(input: MatchInput, mentors: MentorRecord[]): ScoredMentor[] {
  return mentors
    .filter(isEligible)
    .map((m) => scoreMentor(input, m))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.mentor.slots_remaining - a.mentor.slots_remaining ||
        a.mentor.fee - b.mentor.fee ||
        a.mentor.id.localeCompare(b.mentor.id),
    );
}

export function topMatches(input: MatchInput, mentors: MentorRecord[], limit = 3): ScoredMentor[] {
  return rankMentors(input, mentors).slice(0, limit);
}
