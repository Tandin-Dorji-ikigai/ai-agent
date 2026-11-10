import "server-only";
import { COACH_STEPS } from "../coach-steps";
import type { z } from "zod";
import { aiStep } from "./ai";
import { coachLive, fallbackMission, fallbackReview, fallbackSummary, groundLearnings, loadCoachSteps, nextMove } from "./coach";
import type { HandlerContext, HandlerResult } from "./handlers";
import { SENSITIVE_TOPICS, classifyBlocker } from "./policy";
import { rejectGenderedText } from "./prompts";
import { COACH_REPLY_MAX_CHARS, CoachMissionSchema, CoachReviewSchema, CoachSummarySchema } from "./schemas";

// The beginner coach's two agent events (see coach.ts for the steps and prompts).
// Code decides what happens next (retry, next step, hand over); the AI only
// writes the step for this person and reads their report.

/** A live answer that broke a rule (too long, a gendered word) gets one more try before the saved response. */
async function aiStepWithRetry<S extends z.ZodType>(opts: Parameters<typeof aiStep<S>>[0]) {
  const first = await aiStep(opts);
  return first.source === "fallback" && first.fallbackReason === "invalid_output" ? aiStep(opts) : first;
}

function entrepreneurOf(ctx: HandlerContext): string {
  if (!ctx.event.entrepreneur_id) throw new Error("Event has no entrepreneur.");
  return ctx.event.entrepreneur_id;
}

/** coach.started: set step 1 for this person. */
export async function coachStarted(ctx: HandlerContext): Promise<HandlerResult> {
  const entrepreneur_id = entrepreneurOf(ctx);
  const { profile } = await ctx.tools.call("get_entrepreneur_context", { entrepreneur_id });
  const mission = await aiStepWithRetry({
    task: "coach_mission",
    schema: CoachMissionSchema,
    fallback: () => fallbackMission(1, profile, []),
    live: coachLive.mission(1, profile, []),
    validate: rejectGenderedText,
  });
  await ctx.tools.call("set_coach_mission", { entrepreneur_id, step: 1, ...mission.value, done_when: COACH_STEPS[0].done_when, source: mission.source });
  return {
    input_summary: `${profile.full_name} started the beginner coach`,
    decision: `Coach step 1: ${COACH_STEPS[0].title}`,
    factors: ["No business idea yet, so coaching comes before a mentor.", `Personalised to ${profile.location ?? "their district"} and their interests.`],
    output: mission.value.mission,
    source: mission.source,
  };
}

/** coach.replied: read the report, then ask for more, set the next step, or hand over to a mentor. */
export async function coachReplied(ctx: HandlerContext): Promise<HandlerResult> {
  const entrepreneur_id = entrepreneurOf(ctx);
  const step = Number(ctx.event.payload.step);
  const reply = String(ctx.event.payload.reply ?? "").trim();
  if (!step || !reply) throw new Error("Coach reply is missing the step or the reply.");

  const { profile } = await ctx.tools.call("get_entrepreneur_context", { entrepreneur_id });
  const firstName = profile.full_name.split(" ")[0];
  const steps = await loadCoachSteps(entrepreneur_id);
  const current = steps.find((s) => s.step === step);
  if (!current || current.status !== "open") throw new Error(`Coach step ${step} is not open.`);
  const title = COACH_STEPS[step - 1].title;
  const factors: string[] = [];

  // Tax, registration and compliance questions go to a person at YDF (as in check-ins).
  const sensitive = classifyBlocker(reply).filter((t) => SENSITIVE_TOPICS.has(t));
  if (sensitive.length > 0) {
    await ctx.tools.call("create_escalation", {
      entrepreneur_id,
      reason: "specialist_required",
      summary: `During coach step ${step} (${title}), ${firstName} raised: ${reply.slice(0, 450)}`,
      priority: "medium",
    });
    factors.push(`Sensitive topic (${sensitive.join(", ").replaceAll("_", " ")}): handed to YDF.`);
  }

  // People add details in parts: judge everything sent for this step, not only the latest message.
  const report = (current.last_reply ? `${current.last_reply}\n${reply}` : reply).slice(-COACH_REPLY_MAX_CHARS * 3);
  const review = await aiStepWithRetry({
    task: "coach_review",
    schema: CoachReviewSchema,
    fallback: () => fallbackReview(step, report, current.attempts),
    live: coachLive.review(step, current.mission, current.done_when, report, current.attempts, profile),
    validate: rejectGenderedText,
  });
  // Facts the AI pulled out must come from what they wrote.
  const learnings = review.source === "live_ai" ? groundLearnings(review.value.learnings, report) : review.value.learnings;
  const move = nextMove(step, review.value.outcome, current.attempts);
  const feedback =
    review.value.feedback + (sensitive.length > 0 ? " Your question about tax or registration has gone to a person at YDF, who will contact you." : "");
  factors.push(
    review.value.outcome === "complete"
      ? `Report covers the step (${current.attempts + 1} ${current.attempts === 0 ? "try" : "tries"}).`
      : move === "retry"
        ? "Something essential is missing: asked for more."
        : "Third try: moving on so the coaching does not stall.",
  );
  await ctx.tools.call("record_coach_reply", { entrepreneur_id, step, reply: report, accepted: move !== "retry", feedback, learnings, source: review.source });
  const base = { input_summary: `${firstName} reported on coach step ${step} (${title})` };

  if (move === "retry") {
    return { ...base, decision: `Coach step ${step}: ask for more`, factors, output: feedback, source: review.source };
  }

  // Everything found so far, oldest first, feeds the next step.
  const found = [...steps.filter((s) => s.step < step).flatMap((s) => s.learnings), ...learnings];

  if (move === "advance") {
    const next = step + 1;
    const mission = await aiStepWithRetry({
      task: "coach_mission",
      schema: CoachMissionSchema,
      fallback: () => fallbackMission(next, profile, found),
      live: coachLive.mission(next, profile, found),
      validate: rejectGenderedText,
    });
    await ctx.tools.call("set_coach_mission", { entrepreneur_id, step: next, ...mission.value, done_when: COACH_STEPS[next - 1].done_when, source: mission.source });
    return {
      ...base,
      decision: `Coach step ${step} done: set step ${next} (${COACH_STEPS[next - 1].title})`,
      factors: [...factors, `Builds on ${found.length} fact${found.length === 1 ? "" : "s"} from earlier steps.`],
      output: mission.value.mission,
      source: mission.source,
    };
  }

  // Step 4 done: summary for the mentor, then the usual mentor request starts.
  const finished = steps.map((s) => (s.step === step ? { ...s, status: "done" as const, last_reply: report, learnings: [...s.learnings, ...learnings] } : s));
  const summary = await aiStepWithRetry({
    task: "coach_readiness_summary",
    schema: CoachSummarySchema,
    fallback: () => fallbackSummary(profile, finished),
    live: coachLive.summary(profile, finished),
    validate: rejectGenderedText,
  });
  await ctx.tools.call("finish_coach_journey", { entrepreneur_id, summary: summary.value, source: summary.source });
  await ctx.tools.call("send_inbox_message", {
    entrepreneur_id,
    kind: "info",
    body: `Well done, ${firstName}. You finished the four first steps. I am now asking a mentor to meet you, and I will share what you found so you do not have to repeat it.`,
    source: "system",
  });
  return {
    ...base,
    decision: "Coach finished: hand over to a human mentor",
    factors: [...factors, "All four steps done.", "Readiness summary saved for the mentor."],
    output: `Idea: ${summary.value.idea}`,
    source: summary.source,
  };
}
