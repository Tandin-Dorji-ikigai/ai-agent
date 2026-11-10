import { describe, expect, it } from "vitest";
import { DEMO_BLOCKER_REPLY } from "../demo/fixtures";
import { DEMO_IDS } from "../demo/ids";
import { SEED_MENTORS, SEED_RESOURCES } from "../demo/seed-data";
import { classifyBlocker, decideNextStep, validateDecision, type DecisionContext } from "./policy";

const M = DEMO_IDS.mentors;
const unapproved = SEED_RESOURCES.find((r) => !r.approved)!;

function ctx(blocker: string, overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    blocker,
    topics: classifyBlocker(blocker),
    resources: SEED_RESOURCES,
    mentors: SEED_MENTORS,
    currentMentorId: M.dekiWangmo,
    sector: "tourism",
    actionTitle: "Confirm which permits the guided village walk needs",
    entrepreneurName: "Pema Yangchen",
    ...overrides,
  };
}

describe("blocker decision for the Pema demo", () => {
  it("classifies the permits blocker as regulatory compliance only", () => {
    expect(classifyBlocker(DEMO_BLOCKER_REPLY)).toEqual(["regulatory_compliance"]);
  });

  it("escalates to YDF with evidence-based factors", () => {
    const d = decideNextStep(ctx(DEMO_BLOCKER_REPLY));
    expect(d.action).toBe("escalate");
    if (d.action !== "escalate") return;
    expect(d.reason).toBe("specialist_required");
    expect(d.factors).toContain("No approved resource covers regulatory compliance and permits.");
    expect(d.factors).toContain("The current mentor (Deki Wangmo) does not list regulatory compliance and permits.");
    expect(validateDecision(d, ctx(DEMO_BLOCKER_REPLY))).toBeNull();
  });

  it("would suggest a session instead if a verified specialist existed", () => {
    const verifiedLawyer = SEED_MENTORS.map((m) => (m.id === M.namgayWangdi ? { ...m, verified: true } : m));
    const d = decideNextStep(ctx(DEMO_BLOCKER_REPLY, { mentors: verifiedLawyer }));
    expect(d).toMatchObject({ action: "suggest_mentor_session", mentor_id: M.namgayWangdi });
  });
});

describe("other blockers", () => {
  it("recommends the approved pricing worksheet for a pricing blocker", () => {
    const d = decideNextStep(ctx("I am not sure what price to charge per night."));
    expect(d).toMatchObject({ action: "recommend_resource", resource_id: "00000000-0000-4000-8000-000000000202" });
  });

  it("recommends the interview kit for a customer blocker", () => {
    const d = decideNextStep(ctx("I can't reach any past guests to interview."));
    expect(d).toMatchObject({ action: "recommend_resource", resource_id: "00000000-0000-4000-8000-000000000201" });
  });

  it("suggests an eligible mentor when no resource covers the topic", () => {
    const d = decideNextStep(ctx("Staff scheduling is a mess during festivals."));
    expect(d.action).toBe("suggest_mentor_session");
    if (d.action !== "suggest_mentor_session") return;
    const m = SEED_MENTORS.find((x) => x.id === d.mentor_id)!;
    expect(m.verified && m.active && m.slots_remaining > 0 && m.expertise.includes("operations")).toBe(true);
  });
});

describe("validateDecision guards what the AI may choose", () => {
  const c = ctx("I am not sure what price to charge.");

  it("rejects an unapproved resource", () => {
    expect(validateDecision({ action: "recommend_resource", resource_id: unapproved.id, factors: ["x"] }, c)).toMatch(/not approved/);
  });

  it("rejects a resource that does not exist", () => {
    expect(
      validateDecision({ action: "recommend_resource", resource_id: "00000000-0000-4000-8000-000000000999", factors: ["x"] }, c),
    ).toMatch(/does not exist/);
  });

  it("rejects unverified, inactive and fully booked mentors", () => {
    for (const id of [M.namgayWangdi, M.tshewangRinzin, M.kinleyWangchuk]) {
      expect(validateDecision({ action: "suggest_mentor_session", mentor_id: id, factors: ["x"] }, c)).not.toBeNull();
    }
  });

  it("rejects a resource for a sensitive topic", () => {
    const permits = ctx(DEMO_BLOCKER_REPLY);
    const approved = SEED_RESOURCES.find((r) => r.approved)!;
    expect(validateDecision({ action: "recommend_resource", resource_id: approved.id, factors: ["x"] }, permits)).toMatch(/qualified person/);
  });
});
