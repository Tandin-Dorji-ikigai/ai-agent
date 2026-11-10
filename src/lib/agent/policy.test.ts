import { describe, expect, it } from "vitest";
import { DEMO_BLOCKER_REPLY, DEMO_DONE_REPLY, DEMO_OBSTACLE_REPLY, DEMO_ON_TRACK_REPLY } from "../demo/fixtures";
import { DEMO_IDS } from "../demo/ids";
import { SEED_MENTORS, SEED_RESOURCES } from "../demo/seed-data";
import { classifyBlocker, classifyReply, decideNextStep, validateDecision, type DecisionContext } from "./policy";

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

describe("progress status: reading a mentee's reply", () => {
  it("reads the demo replies into the four workflow branches", () => {
    expect(classifyReply(DEMO_ON_TRACK_REPLY)).toMatchObject({ status: "on_track", needs_help: false });
    expect(classifyReply(DEMO_DONE_REPLY)).toMatchObject({ status: "done", needs_help: false });
    expect(classifyReply(DEMO_OBSTACLE_REPLY)).toMatchObject({ status: "stuck", needs_help: false });
    expect(classifyReply(DEMO_BLOCKER_REPLY)).toMatchObject({ status: "stuck", needs_help: true });
  });

  it("treats a stuck reply with no explanation as needing help", () => {
    expect(classifyReply("I'm stuck on the pricing.")).toMatchObject({ status: "stuck", needs_help: true });
  });

  it("handles curly apostrophes from phone keyboards", () => {
    expect(classifyReply("I don\u2019t know which form to use")).toMatchObject({ status: "stuck", needs_help: true });
  });

  it("does not read 'will' as 'ill'", () => {
    expect(classifyReply("I will finish it tomorrow.")).toMatchObject({ status: "on_track" });
  });
});

describe("request to the mentee's own mentor", () => {
  it("asks the current mentor when no approved resource covers a topic they list", () => {
    const d = decideNextStep(ctx("I can't find guests willing to talk to me.", { resources: [] }));
    expect(d).toMatchObject({ action: "request_mentor_help", mentor_id: M.dekiWangmo });
    expect(validateDecision(d, ctx("I can't find guests willing to talk to me.", { resources: [] }))).toBeNull();
  });

  it("asks the current mentor about an unclear blocker", () => {
    const d = decideNextStep(ctx("Something came up with my cousin and the house."));
    expect(d).toMatchObject({ action: "request_mentor_help", mentor_id: M.dekiWangmo });
  });

  it("only allows requests to the mentee's own mentor", () => {
    const c = ctx("I am stuck.");
    expect(validateDecision({ action: "request_mentor_help", mentor_id: M.sonamChoden, factors: ["x"] }, c)).toMatch(/own mentor/);
  });

  it("does not send a sensitive topic to a mentor who does not list it", () => {
    const c = ctx(DEMO_BLOCKER_REPLY);
    expect(validateDecision({ action: "request_mentor_help", mentor_id: M.dekiWangmo, factors: ["x"] }, c)).toMatch(/sensitive/);
  });
});
