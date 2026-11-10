import { describe, expect, it } from "vitest";
import { PEMA_ASSESSMENT_ANSWERS } from "../demo/fixtures";
import { DEMO_IDS } from "../demo/ids";
import { SEED_MENTORS } from "../demo/seed-data";
import type { EntrepreneurRecord } from "../types";
import { closedReason, fundingFor, isBookable, MAX_REQUESTS_PER_ROUND, menteeSummary, pickNextMentor } from "./requests";
import { rankMentors, scoreMentor } from "./score-mentor";

const M = DEMO_IDS.mentors;
const pema: EntrepreneurRecord = {
  id: DEMO_IDS.pema,
  full_name: "Pema Yangchen",
  location: "Rural Thimphu Dzongkhag",
  ...PEMA_ASSESSMENT_ANSWERS,
  goals: [],
  assessment_summary: "Runs a village homestay and wants to understand guests.",
  assessment_completed_at: "2026-11-10T09:00:00.000Z",
};
const ranked = rankMentors(pema, SEED_MENTORS);
const mentor = (id: string) => SEED_MENTORS.find((m) => m.id === id)!;

describe("who the agent asks, in order", () => {
  it("asks Deki first, then Sonam, then Ugyen as each one says no", () => {
    const asked: string[] = [];
    const order = [];
    for (let i = 0; i < MAX_REQUESTS_PER_ROUND; i++) {
      const next = pickNextMentor(ranked, asked)!;
      order.push(next.mentor.full_name);
      asked.push(next.mentor.id);
    }
    expect(order).toEqual(["Deki Wangmo", "Sonam Choden", "Ugyen Lhendup"]);
  });

  it("never asks a fully booked, inactive or unverified mentor", () => {
    expect(isBookable(mentor(M.kinleyWangchuk))).toBe(false); // fully booked
    expect(isBookable(mentor(M.tshewangRinzin))).toBe(false); // inactive
    expect(isBookable(mentor(M.namgayWangdi))).toBe(false); // unverified
    expect(isBookable(mentor(M.dekiWangmo))).toBe(true);
    const everyone: string[] = [];
    for (let next = pickNextMentor(ranked, everyone); next; next = pickNextMentor(ranked, everyone)) everyone.push(next.mentor.id);
    expect(everyone).not.toContain(M.kinleyWangchuk);
    expect(everyone.every((id) => isBookable(mentor(id)))).toBe(true);
  });

  it("does not ask a mentor whose fit is too weak, and runs out instead", () => {
    const everyone: string[] = [];
    for (let next = pickNextMentor(ranked, everyone); next; next = pickNextMentor(ranked, everyone)) everyone.push(next.mentor.id);
    expect(everyone.every((id) => scoreMentor(pema, mentor(id)).score >= 40)).toBe(true);
    expect(pickNextMentor(ranked, everyone)).toBeNull();
  });

  it("finds a first mentor for an aspiring entrepreneur with no business yet", () => {
    const aspiring = rankMentors(
      { sector: "undecided", business_stage: "idea", preferred_language: "en", languages: ["en"], expertise_needs: ["idea_development"], budget: 0 },
      SEED_MENTORS,
    );
    expect(["Ugyen Lhendup", "Dawa Penjor"]).toContain(pickNextMentor(aspiring, [])?.mentor.full_name);
  });
});

describe("how the session is paid", () => {
  it("uses YDF credit only when it covers the whole fee", () => {
    expect(fundingFor({ amount_remaining: 3000, status: "active" }, 1500)).toBe("ydf_credit");
    expect(fundingFor({ amount_remaining: 1000, status: "active" }, 1500)).toBe("self_paid");
    expect(fundingFor({ amount_remaining: 3000, status: "expired" }, 1500)).toBe("self_paid");
    expect(fundingFor(null, 1500)).toBe("self_paid");
  });
});

describe("what the mentor sees", () => {
  it("shares needs and why they were picked, but no phone number or budget", () => {
    const s = menteeSummary(pema, scoreMentor(pema, mentor(M.dekiWangmo)), false);
    expect(s.full_name).toBe("Pema Yangchen");
    expect(s.needs).toEqual(["Customer validation", "Market positioning", "Pricing"]);
    expect(s.why[0]).toBe("You cover 2 of 3 needs: Customer validation, Market positioning.");
    expect(s.why).toContain("Same sector: Tourism.");
    expect(Object.keys(s)).not.toContain("budget");
    expect(Object.keys(s)).not.toContain("phone");
    expect(JSON.stringify(s)).not.toMatch(/1,?500|Nu\./);
  });
});

describe("what the mentee is told when a mentor cannot", () => {
  it("gives the reason kindly, without the mentor's private note", () => {
    expect(closedReason("no_time", "Deki")).toBe("Deki has no time for a new mentee this week");
    expect(closedReason("expired", "Sonam")).toBe("Sonam did not reply within 2 days");
    expect(closedReason("not_my_area", "Ugyen")).toMatch(/another mentor would suit/);
    expect(closedReason(null, "Ugyen")).toBe("Ugyen cannot take this on right now");
  });
});
