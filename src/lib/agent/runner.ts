import "server-only";
import { demoNow } from "../clock";
import { db, must } from "../supabase/server";
import type { EventType } from "../types";
import { ALLOWED_TOOLS, HANDLERS, type AgentEventRow } from "./handlers";
import { Toolbox, ToolError } from "./tools";

// The agent runner (README.md, "Agent execution loop").
//
// For the hackathon, events run INLINE right after they are created, so the
// demo never waits for a background worker. The agent_events table still
// records every event, and a failed event can be retried via /api/agent/run.

export interface EmitInput {
  event_type: EventType;
  entity_type: string;
  entity_id?: string | null;
  entrepreneur_id?: string | null;
  payload?: Record<string, unknown>;
  /** Same key = same event. Used to ignore double clicks and repeats. */
  dedupe_key?: string | null;
}

export interface RunOutcome {
  event_id: string;
  run_id: string | null;
  status: "completed" | "failed" | "skipped";
  decision?: string | null;
  output?: string | null;
  error?: string;
}

function safeError(err: unknown): string {
  if (err instanceof ToolError) return `${err.code}: ${err.message}`.slice(0, 300);
  if (err instanceof Error) return err.message.slice(0, 300);
  return "Unknown error";
}

export async function emitAndRun(input: EmitInput): Promise<RunOutcome> {
  const now = await demoNow();
  const row = {
    event_type: input.event_type,
    entity_type: input.entity_type,
    entity_id: input.entity_id ?? null,
    entrepreneur_id: input.entrepreneur_id ?? null,
    payload: input.payload ?? {},
    dedupe_key: input.dedupe_key ?? null,
    status: "pending",
    scheduled_for: now.toISOString(),
    created_at: now.toISOString(),
  };

  if (row.dedupe_key) {
    const inserted = must(
      await db().from("agent_events").upsert(row, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id"),
      "emit event",
    ) as Array<{ id: string }>;
    if (inserted.length === 0) {
      // Duplicate. Only process it if an earlier attempt never finished.
      const existing = must(
        await db().from("agent_events").select("id, status").eq("dedupe_key", row.dedupe_key).single(),
        "load duplicate event",
      ) as { id: string; status: string };
      if (existing.status === "pending" || existing.status === "failed") return processEvent(existing.id);
      return { event_id: existing.id, run_id: null, status: "skipped" };
    }
    return processEvent(inserted[0].id);
  }

  const inserted = must(await db().from("agent_events").insert(row).select("id").single(), "emit event") as { id: string };
  return processEvent(inserted.id);
}

export async function processEvent(eventId: string): Promise<RunOutcome> {
  const event = must(
    await db().from("agent_events").select("*").eq("id", eventId).maybeSingle(),
    "load event",
  ) as AgentEventRow | null;
  if (!event) return { event_id: eventId, run_id: null, status: "failed", error: "Event not found." };
  if (event.status !== "pending" && event.status !== "failed") {
    return { event_id: eventId, run_id: null, status: "skipped" };
  }

  // Atomic claim: only one request can move this exact (status, attempts) pair.
  const claimed = must(
    await db()
      .from("agent_events")
      .update({ status: "processing", attempts: event.attempts + 1, error: null })
      .eq("id", eventId)
      .eq("status", event.status)
      .eq("attempts", event.attempts)
      .select("id"),
    "claim event",
  ) as Array<{ id: string }>;
  if (claimed.length === 0) return { event_id: eventId, run_id: null, status: "skipped" };

  const now = await demoNow();
  const run = must(
    await db()
      .from("agent_runs")
      .insert({
        event_id: eventId,
        entrepreneur_id: event.entrepreneur_id,
        trigger: event.event_type,
        status: "running",
        created_at: now.toISOString(),
      })
      .select("id")
      .single(),
    "start run",
  ) as { id: string };

  const tools = new Toolbox(ALLOWED_TOOLS[event.event_type], { now });
  try {
    const result = await HANDLERS[event.event_type]({ event, tools, now });
    must(
      await db()
        .from("agent_runs")
        .update({
          status: "completed",
          input_summary: result.input_summary,
          tools_called: tools.calls,
          decision: result.decision ?? null,
          decision_factors: result.factors ?? [],
          final_output: result.output,
          source: result.source,
          completed_at: now.toISOString(),
        })
        .eq("id", run.id)
        .select("id"),
      "finish run",
    );
    must(
      await db()
        .from("agent_events")
        .update({ status: "completed", processed_at: now.toISOString() })
        .eq("id", eventId)
        .select("id"),
      "complete event",
    );
    return { event_id: eventId, run_id: run.id, status: "completed", decision: result.decision ?? null, output: result.output };
  } catch (err) {
    const message = safeError(err);
    await db()
      .from("agent_runs")
      .update({ status: "failed", error: message, tools_called: tools.calls, completed_at: now.toISOString() })
      .eq("id", run.id);
    await db().from("agent_events").update({ status: "failed", error: message }).eq("id", eventId);
    return { event_id: eventId, run_id: run.id, status: "failed", error: message };
  }
}
