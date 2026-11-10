import "server-only";
import { emitAndRun, type RunOutcome } from "./agent/runner";
import { ToolError } from "./agent/tools";
import { loadEntrepreneur } from "./data";
import { DEMO_IDS } from "./demo/ids";
import { ensureMentorRequest } from "./requests";
import { db, must } from "./supabase/server";

// What the mentee does on the coach screen. The agent's work happens in the
// coach.started / coach.replied events (src/lib/agent/coach-handlers.ts).

const ENTREPRENEUR = DEMO_IDS.pema;

async function journeyStatus(): Promise<string | null> {
  const row = must(
    await db().from("coach_journeys").select("status").eq("entrepreneur_id", ENTREPRENEUR).maybeSingle(),
    "load coach journey",
  ) as { status: string } | null;
  return row?.status ?? null;
}

/** Start the coach (step 1). Safe to call twice. */
export async function startCoach(): Promise<{ started: boolean; outcome: RunOutcome | null }> {
  const entrepreneur = await loadEntrepreneur(ENTREPRENEUR);
  if (!entrepreneur?.assessment_completed_at) throw new ToolError("ASSESSMENT_REQUIRED", "Complete the needs assessment first.");
  const status = await journeyStatus();
  if (status === "ready") return { started: false, outcome: null };
  if (status === "skipped") {
    // Changed their mind: coaching again from where they left off.
    must(await db().from("coach_journeys").update({ status: "active" }).eq("entrepreneur_id", ENTREPRENEUR).select("entrepreneur_id"), "resume coach");
  }
  const outcome = await emitAndRun({
    event_type: "coach.started",
    entity_type: "entrepreneur",
    entity_id: ENTREPRENEUR,
    entrepreneur_id: ENTREPRENEUR,
    dedupe_key: `coach.started:${ENTREPRENEUR}`,
  });
  return { started: true, outcome };
}

/** The mentee reports on the open step. One report per try, so a double tap is ignored. */
export async function replyToCoach(step: number, reply: string, source: "typed" | "voice_note"): Promise<RunOutcome> {
  if ((await journeyStatus()) !== "active") throw new ToolError("COACH_NOT_ACTIVE", "The coach is not active. Start it first.");
  const open = must(
    await db().from("coach_steps").select("step, attempts").eq("entrepreneur_id", ENTREPRENEUR).eq("status", "open").order("step").limit(1).maybeSingle(),
    "load open coach step",
  ) as { step: number; attempts: number } | null;
  if (!open || open.step !== step) throw new ToolError("STEP_NOT_OPEN", "This step is already done. Refresh to see the next one.");
  const outcome = await emitAndRun({
    event_type: "coach.replied",
    entity_type: "coach_step",
    entity_id: ENTREPRENEUR,
    entrepreneur_id: ENTREPRENEUR,
    payload: { step, reply, source },
    dedupe_key: `coach.replied:${ENTREPRENEUR}:${step}:${open.attempts + 1}`,
  });
  // Step 4 done: the agent now asks a mentor (the usual request, with the coach summary).
  if ((await journeyStatus()) === "ready") await ensureMentorRequest(ENTREPRENEUR);
  return outcome;
}

/** "Ask a human mentor now": stop coaching; the usual mentor request starts. */
export async function skipCoach(now: Date): Promise<void> {
  if ((await journeyStatus()) === "ready") return;
  must(
    await db()
      .from("coach_journeys")
      .upsert({ entrepreneur_id: ENTREPRENEUR, status: "skipped", finished_at: now.toISOString() }, { onConflict: "entrepreneur_id" })
      .select("entrepreneur_id"),
    "skip coach",
  );
  await ensureMentorRequest(ENTREPRENEUR);
}
