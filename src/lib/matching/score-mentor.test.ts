import { describe, expect, it } from "vitest";
import { PEMA_ASSESSMENT_ANSWERS } from "../demo/fixtures";
import { DEMO_IDS } from "../demo/ids";
import { SEED_MENTORS } from "../demo/seed-data";
import { rankMentors, scoreMentor, topMatches, type MatchInput } from "./score-mentor";

const pema: MatchInput = {
  sector: PEMA_ASSESSMENT_ANSWERS.sector,
  business_stage: PEMA_ASSESSMENT_ANSWERS.business_stage,
  preferred_language: PEMA_ASSESSMENT_ANSWERS.preferred_language,
  languages: PEMA_ASSESSMENT_ANSWERS.languages,
  expertise_needs: PEMA_ASSESSMENT_ANSWERS.expertise_needs,
  budget: PEMA_ASSESSMENT_ANSWERS.budget,
};
const M = DEMO_IDS.mentors;
const mentor = (id: string) => SEED_MENTORS.find((m) => m.id === id)!;

describe("mentor matching for the Pema demo", () => {
  it("returns Deki, Sonam and Ugyen as the top three, in that order", () => {
    const top = topMatches(pema, SEED_MENTORS);
    expect(top.map((t) => [t.mentor.full_name, t.score])).toEqual([
      ["Deki Wangmo", 88],
      ["Sonam Choden", 77],
      ["Ugyen Lhendup", 70],
    ]);
  });

  it("ranks a Dzongkha-speaking tourism mentor first", () => {
    const first = topMatches(pema, SEED_MENTORS, 1)[0].mentor;
    expect(first.languages).toContain("dz");
    expect(first.sectors).toContain("tourism");
  });

  it("does not recommend the most-booked mentor just because they are popular", () => {
    const popular = [...SEED_MENTORS].sort((a, b) => b.sessions_delivered - a.sessions_delivered)[0];
    expect(popular.id).toBe(M.karmaTshering);
    const top3 = topMatches(pema, SEED_MENTORS).map((t) => t.mentor.id);
    expect(top3).not.toContain(popular.id);
    expect(scoreMentor(pema, popular).score).toBe(5);
  });

  it("returns only verified and active mentors", () => {
    const ranked = rankMentors(pema, SEED_MENTORS);
    expect(ranked.every((r) => r.mentor.verified && r.mentor.active)).toBe(true);
    const ids = ranked.map((r) => r.mentor.id);
    expect(ids).not.toContain(M.namgayWangdi); // unverified
    expect(ids).not.toContain(M.tshewangRinzin); // inactive, would otherwise score 100
    expect(scoreMentor(pema, mentor(M.tshewangRinzin)).score).toBe(100);
    expect(ranked).toHaveLength(13);
  });

  it("removes availability points from a fully booked mentor", () => {
    expect(scoreMentor(pema, mentor(M.kinleyWangchuk)).breakdown.availability).toBe(0);
    expect(scoreMentor(pema, mentor(M.dawaPenjor)).breakdown.availability).toBe(5);
    expect(scoreMentor(pema, mentor(M.dekiWangmo)).breakdown.availability).toBe(10);
  });

  it("removes budget points from a mentor over budget", () => {
    expect(scoreMentor(pema, mentor(M.dekiWangmo)).breakdown.budget).toBe(10); // 1500 <= 1500
    expect(scoreMentor(pema, mentor(M.ugyenLhendup)).breakdown.budget).toBe(5); // 2000 <= 2250
    expect(scoreMentor(pema, mentor(M.karmaTshering)).breakdown.budget).toBe(0); // 4000
  });

  it("gives partial expertise points in proportion to needs covered", () => {
    expect(scoreMentor(pema, mentor(M.ugyenLhendup)).breakdown.expertise).toBe(35); // 3 of 3
    expect(scoreMentor(pema, mentor(M.dekiWangmo)).breakdown.expertise).toBe(23); // 2 of 3
    expect(scoreMentor(pema, mentor(M.sonamChoden)).breakdown.expertise).toBe(12); // 1 of 3
  });

  it("keeps every score between 0 and 100 and equal to its breakdown", () => {
    for (const m of SEED_MENTORS) {
      const s = scoreMentor(pema, m);
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
      expect(Object.values(s.breakdown).reduce((a, b) => a + b, 0)).toBe(s.score);
    }
  });

  it("breaks ties deterministically, whatever order the mentors arrive in", () => {
    const forward = rankMentors(pema, SEED_MENTORS).map((r) => r.mentor.id);
    const reversed = rankMentors(pema, [...SEED_MENTORS].reverse()).map((r) => r.mentor.id);
    expect(reversed).toEqual(forward);
    // Jigme and Rinchen both score 35; Jigme has open slots, so ranks first.
    expect(forward.indexOf(M.jigmeNamgyel)).toBeLessThan(forward.indexOf(M.rinchenZangmo));
  });
});
