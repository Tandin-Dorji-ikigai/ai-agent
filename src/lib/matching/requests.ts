// Rules for mentor requests: who the agent asks next, how it is paid, and
// what the mentor sees. Pure (no database), so it is unit-tested and the
// AI never decides any of it.

import {
  LANGUAGE_LABEL,
  expertiseLabel,
  sectorLabel,
  stageLabel,
  type DeclineReason,
  type EntrepreneurRecord,
  type FundingType,
  type MenteeSummary,
  type MentorRecord,
} from "../types";
import { WEIGHTS, type ScoredMentor } from "./score-mentor";
import { validSlots } from "./slots";

/** The agent asks at most this many mentors before it hands over to YDF. */
export const MAX_REQUESTS_PER_ROUND = 3;
/** A mentor has this long to reply before the agent moves on. */
export const REQUEST_TTL_HOURS = 48;
/** Below this score the fit is too weak to ask a mentor for their time. */
export const MIN_REQUEST_SCORE = 40;

/** Can be asked now: verified, active, an open session and at least one usual weekly time. */
export function isBookable(m: MentorRecord): boolean {
  return m.verified && m.active && m.slots_remaining >= 1 && validSlots(m.weekly_slots).length > 0;
}

/** The best-ranked mentor who can be asked and has not been asked in this round. */
export function pickNextMentor(ranked: ScoredMentor[], askedIds: Iterable<string>): ScoredMentor | null {
  const asked = new Set(askedIds);
  return ranked.find((r) => isBookable(r.mentor) && !asked.has(r.mentor.id) && r.score >= MIN_REQUEST_SCORE) ?? null;
}

/** YDF credit when it covers the whole fee, otherwise simulated self-payment. */
export function fundingFor(credit: { amount_remaining: number; status: string } | null, fee: number): FundingType {
  return credit && credit.status === "active" && credit.amount_remaining >= fee ? "ydf_credit" : "self_paid";
}

/** Plain facts from the score, written to the mentor ("You cover ..."). */
export function whyMatched(e: Pick<EntrepreneurRecord, "expertise_needs" | "sector" | "business_stage" | "preferred_language">, s: ScoredMentor): string[] {
  const out: string[] = [];
  const needs = [...new Set(e.expertise_needs)];
  if (s.matched_expertise.length > 0) {
    out.push(`You cover ${s.matched_expertise.length} of ${needs.length} needs: ${s.matched_expertise.map(expertiseLabel).join(", ")}.`);
  }
  if (s.breakdown.sector > 0 && e.sector) out.push(`Same sector: ${sectorLabel(e.sector)}.`);
  if (s.breakdown.business_stage > 0 && e.business_stage) out.push(`You mentor businesses at this stage (${stageLabel(e.business_stage)}).`);
  if (s.breakdown.language === WEIGHTS.language) out.push(`You speak ${LANGUAGE_LABEL[e.preferred_language]}, the language they prefer.`);
  return out;
}

/**
 * What the mentor sees about the mentee. Need-to-know only: no phone number
 * and no budget (so not the assessment summary either, which mentions it).
 */
export function menteeSummary(e: EntrepreneurRecord, scored: ScoredMentor | null, followUp: boolean): MenteeSummary {
  return {
    full_name: e.full_name,
    location: e.location,
    business_name: e.business_name,
    business_stage: e.business_stage,
    sector: e.sector,
    needs: [...new Set(e.expertise_needs)].map(expertiseLabel),
    challenge: e.primary_challenge,
    preferred_language: e.preferred_language,
    progress_so_far: e.progress_so_far,
    timeframe: e.timeframe,
    mentoring_format: e.mentoring_format,
    why: scored ? whyMatched(e, scored) : [],
    follow_up: followUp,
  };
}

/** Why the last mentor is not going ahead, as the mentee is told it. */
export function closedReason(reason: DeclineReason | "expired" | null, mentorFirstName: string): string {
  switch (reason) {
    case "no_time":
      return `${mentorFirstName} has no time for a new mentee this week`;
    case "not_my_area":
      return `${mentorFirstName} thinks another mentor would suit your needs better`;
    case "expired":
      return `${mentorFirstName} did not reply within ${REQUEST_TTL_HOURS / 24} days`;
    default:
      return `${mentorFirstName} cannot take this on right now`;
  }
}
