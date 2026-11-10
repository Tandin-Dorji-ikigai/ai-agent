import "server-only";
import { COACH_STEP_COUNT, COACH_STEPS, MAX_ATTEMPTS } from "../coach-steps";
import type { EntrepreneurRecord } from "../types";
import { isExploring } from "../mentorflow-assessment";
import { db, must } from "../supabase/server";
import { sectorLabel } from "../types";
import { structured, MODELS } from "./llm";
import { NO_GENDER_RULE } from "./prompts";
import { CoachMissionSchema, CoachReviewSchema, CoachSummarySchema, type CoachMission, type CoachReview, type CoachSummary } from "./schemas";

// Beginner coach (someone with no business idea yet). Four fixed steps, so the
// path is predictable and checkable; the AI only personalises each step and
// reads what the person reports back. After step 4 a human mentor takes over.
//
//   1. Notice problems around you      3. Pick one idea
//   2. Talk to three people            4. Try a small test
//
// Every AI step has a rule-based fallback (no AI, or AI busy), like the rest
// of the agent, and nothing the AI writes may add facts the person did not say.

export interface CoachStepRecord {
  step: number;
  mission: string;
  status: "open" | "done";
  attempts: number;
  last_reply: string | null;
  learnings: string[];
}

// ---------------------------------------------------------------------------
// Decisions (code, not AI)
// ---------------------------------------------------------------------------

/** What happens after a reply: next step, try again, or (after step 4) hand over to a mentor. */
export function nextMove(step: number, outcome: CoachReview["outcome"], attemptsSoFar: number): "advance" | "retry" | "hand_over" {
  const accepted = outcome === "complete" || attemptsSoFar + 1 >= MAX_ATTEMPTS;
  if (!accepted) return "retry";
  return step >= COACH_STEP_COUNT ? "hand_over" : "advance";
}

const WORD = /[a-zༀ-࿿]{4,}/gi;
const STOP = new Set(["that", "this", "with", "they", "them", "their", "have", "about", "would", "could", "there", "from", "what", "when", "your", "people", "think", "because", "really", "some"]);

/** Keep only learnings that share a real word with what the person wrote (no invented facts). */
export function groundLearnings(learnings: string[], reply: string): string[] {
  const said = new Set((reply.toLowerCase().match(WORD) ?? []).filter((w) => !STOP.has(w)));
  return learnings.filter((l) => (l.toLowerCase().match(WORD) ?? []).some((w) => !STOP.has(w) && said.has(w))).slice(0, 4);
}

// ---------------------------------------------------------------------------
// Rule-based fallbacks (saved responses)
// ---------------------------------------------------------------------------

function interest(e: EntrepreneurRecord): string {
  return e.sector === "undecided" ? "the things you care about" : sectorLabel(e.sector).toLowerCase();
}
function place(e: EntrepreneurRecord): string {
  return e.location?.trim() || "your area";
}

export function fallbackMission(step: number, e: EntrepreneurRecord, learnings: string[]): CoachMission {
  const found = learnings[0] ? ` You noted: "${learnings[0].slice(0, 120)}".` : "";
  switch (step) {
    case 1:
      return {
        mission: `This week, notice three everyday problems people in ${place(e)} have, ideally linked to ${interest(e)}. Write each one in a sentence: who has it, and when it happens.`,
        why: "Good businesses start from a real problem, not from a product idea.",
        example: "Farmers near my village lose vegetables because there is no cold storage before the weekly market.",
      };
    case 2:
      return {
        mission: `Pick the problem you care most about and ask three people who have it: how do they deal with it today, and what does it cost them in money or time?${found}`,
        why: "Hearing it from people who have the problem tells you if it is real and how much it matters.",
        example: "Two shop owners said they throw away about Nu. 500 of vegetables a week; one did not see it as a problem.",
      };
    case 3:
      return {
        mission: `Choose the one problem that came up most strongly. Describe one simple way you could help, who would pay for it, and roughly how much.${found}`,
        why: "A clear idea with a paying customer is something a mentor can help you test properly.",
        example: "A small shared cold box at the market. Shop owners would pay about Nu. 100 a week.",
      };
    default:
      return {
        mission: `Try the smallest test of your idea: ask five people if they would pay your price, take a pre-order, or offer one free sample. Note what each person did.${found}`,
        why: "What people do (pay, order, come back) tells you more than what they say.",
        example: "I asked 5 shop owners. 2 paid a Nu. 100 deposit, 1 wants to try it next month.",
      };
  }
}

const NUMBER = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i;

/** No AI: a reply counts as complete when it is substantial and has the step's key signal. */
export function fallbackReview(step: number, reply: string, attemptsSoFar: number): CoachReview {
  const text = reply.trim();
  // "Nu. 300" is a price, not the end of a sentence.
  const sentences = text.replace(/\bNu\.\s?(?=\d)/g, "Nu ").split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 8);
  const longEnough = text.length >= 60;
  const signal =
    step === 1 ? sentences.length >= 2 || /,|;| and /.test(text) :
    step === 2 ? NUMBER.test(text) || /\bsaid|told|asked\b/i.test(text) :
    step === 3 ? /\bpay|price|nu\.?\s?\d|customer|sell\b/i.test(text) :
    NUMBER.test(text);
  const complete = longEnough && signal;
  const learnings = sentences.slice(0, 3).map((s) => s.slice(0, 200));
  const goal = COACH_STEPS[step - 1].goal;
  return {
    outcome: complete ? "complete" : "needs_more",
    feedback: complete
      ? "Thank you, that is useful. I have saved what you found for your next step."
      : attemptsSoFar + 1 >= MAX_ATTEMPTS
        ? "Thank you. Let us keep going with what you have; your mentor can help you fill the gaps."
        : `Thanks. Could you add a bit more? The goal of this step: ${goal}`,
    learnings,
  };
}

export function fallbackSummary(e: EntrepreneurRecord, steps: CoachStepRecord[]): CoachSummary {
  const by = (n: number) => steps.find((s) => s.step === n);
  const first = (n: number) => by(n)?.learnings[0] ?? by(n)?.last_reply?.slice(0, 200) ?? "";
  const evidence = [...(by(2)?.learnings ?? []), ...(by(4)?.learnings ?? [])].slice(0, 4);
  return {
    problem: first(1) || "Still being defined.",
    who_has_it: (by(2)?.learnings[0] ?? "People the mentee spoke to").slice(0, 240),
    idea: first(3) || "Still being defined.",
    evidence: evidence.length ? evidence : ["See the mentee's notes from the coach steps."],
    questions_for_mentor: [`How should ${e.full_name.split(" ")[0]} test this idea with more customers?`, "What is the simplest way to start without much money?"],
  };
}

// ---------------------------------------------------------------------------
// Live AI (Groq), same client and limits as the rest of the agent
// ---------------------------------------------------------------------------

const COACH_ROLE = [
  "You are an AI coach for first steps only, for someone in Bhutan who has no business idea yet.",
  "You set one small, practical, free or very cheap task at a time, doable in one to three days on foot or by phone.",
  "You do not replace the human mentor: after four steps a verified human mentor takes over.",
  "Never give legal, tax, registration or financial advice; say a YDF person will help with that.",
  "Use only facts the person gave you. Never invent people, numbers, places, organisations or results.",
  "Write short, plain, warm sentences for a first-time entrepreneur reading on a phone.",
].join("\n");
const sys = (task: string) => `${COACH_ROLE}\n\nTASK\n${task}\n\n${NO_GENDER_RULE}`;

function personFacts(e: EntrepreneurRecord) {
  return {
    first_name: e.full_name.split(" ")[0],
    district: e.location,
    interest: e.sector === "undecided" ? "not decided yet" : sectorLabel(e.sector),
    strengths_and_motivation: e.business_description,
    what_holds_them_back: e.primary_challenge,
    goals: e.goals,
  };
}

export const coachLive = {
  mission:
    (step: number, e: EntrepreneurRecord, learnings: string[]) =>
    (signal: AbortSignal) =>
      structured({
        task: "coach_mission",
        model: MODELS.light,
        maxTokens: 700,
        schema: CoachMissionSchema,
        signal,
        system: sys(
          `Write step ${step} of 4: "${COACH_STEPS[step - 1].title}". Its goal: ${COACH_STEPS[step - 1].goal} ` +
            `Their report will be checked only against this: "${COACH_STEPS[step - 1].done_when}" ` +
            "Rules for your text (follow them; never mention them in the text): speak to them directly as you; " +
            "the mission is under 350 characters, names their district and/or interest when given, and builds on what they found so far; " +
            "suggest, never decide for them (they choose which problem or idea to follow); ask for nothing beyond the check. " +
            "Fields: mission: the task. why: one sentence on why it matters. " +
            "example: under 200 characters, a made-up example of a report that meets the check, in the first person as they would write it " +
            "(\"I asked three ...\"), generic, not about them.",
        ),
        user: JSON.stringify({ person: personFacts(e), found_so_far: learnings }),
      }),

  review:
    (step: number, mission: string, doneWhen: string, reply: string, attemptsSoFar: number, e: EntrepreneurRecord) =>
    (signal: AbortSignal) =>
      structured({
        task: "coach_review",
        model: MODELS.light,
        maxTokens: 600,
        schema: CoachReviewSchema,
        signal,
        system: sys(
          "Read what the person reports back on their step. The report may arrive in several messages: judge everything sent for this step together. " +
            "outcome: complete if the report covers what done_when asks for " +
            "(be generous with a first-time entrepreneur: rough is fine), needs_more only if something done_when asks for is missing. " +
            "Never ask for anything done_when does not ask for. " +
            "feedback: two or three sentences spoken directly to them as you (never in the third person): one specific thing they did well, then (if needs_more) exactly what to add. " +
            "learnings: up to 4 short facts taken ONLY from their report (who, what, how many, how much), in their words; " +
            "none if the report has no facts. " +
            (attemptsSoFar + 1 >= MAX_ATTEMPTS ? "This is their last try on this step: be encouraging either way." : ""),
        ),
        user: JSON.stringify({ first_name: e.full_name.split(" ")[0], step: COACH_STEPS[step - 1].title, mission, done_when: doneWhen, report: reply }),
      }),

  summary:
    (e: EntrepreneurRecord, steps: CoachStepRecord[]) =>
    (signal: AbortSignal) =>
      structured({
        task: "coach_readiness_summary",
        model: MODELS.main,
        maxTokens: 800,
        schema: CoachSummarySchema,
        signal,
        system: sys(
          "The person finished the four steps. Write what their human mentor should know before the first session. " +
            "problem; who_has_it: the people who have the problem (never the mentee themself); idea (their idea, in their words); " +
            "evidence: up to 4 facts from their talks and test " +
            "(numbers if they gave any); questions_for_mentor: 1 to 3 questions the mentor could help with. " +
            "Use only what the steps contain.",
        ),
        user: JSON.stringify({ person: personFacts(e), steps: steps.map((s) => ({ step: COACH_STEPS[s.step - 1].title, mission: s.mission, report: s.last_reply, facts: s.learnings })) }),
      }),
};

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export interface CoachStepRow extends CoachStepRecord {
  done_when: string;
}

export async function loadCoachSteps(entrepreneurId: string): Promise<CoachStepRow[]> {
  return must(
    await db()
      .from("coach_steps")
      .select("step, mission, done_when, status, attempts, last_reply, learnings")
      .eq("entrepreneur_id", entrepreneurId)
      .order("step"),
    "load coach steps",
  ) as CoachStepRow[];
}

/**
 * Someone with no idea yet coaches first: no mentor is asked until the four
 * steps are done (ready) or they asked for a mentor straight away (skipped).
 */
export async function coachComesFirst(e: Pick<EntrepreneurRecord, "id" | "business_name" | "business_stage">): Promise<boolean> {
  if (!isExploring(e)) return false;
  const row = must(
    await db().from("coach_journeys").select("status").eq("entrepreneur_id", e.id).maybeSingle(),
    "load coach journey",
  ) as { status: string } | null;
  return row?.status !== "ready" && row?.status !== "skipped";
}
