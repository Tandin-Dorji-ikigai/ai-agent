"use client";

import { useState } from "react";
import { DEMO_FAST_FORWARD_DAYS } from "@/lib/demo/fixtures";
import { TRIGGER_LABEL, formatDay, formatDayTime, formatNu } from "@/lib/format";
import type { AgentRunView, DemoState } from "@/lib/state-types";
import { DemoGate, LastError } from "./demo-gate";
import { useDemo } from "./demo-state";
import { Badge, Button, Card, SectionTitle, SourceBadge, StatusBadge } from "./ui";
import { FRONTEND_PREVIEW } from "@/lib/frontend-api";

// YDF: sponsorship, outcomes, escalations and full visibility of what the
// agent did and why. Every number here is read from the database.

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {detail && <p className="text-xs text-muted">{detail}</p>}
    </Card>
  );
}

export function DemoControls({ state }: { state: DemoState }) {
  const { act, busy } = useDemo();
  const [confirmReset, setConfirmReset] = useState(false);
  const done = state.steps.filter((s) => s.done).length;
  return (
    <Card>
      <SectionTitle aside={<Badge tone={done === 14 ? "success" : "accent"}>{done}/14 steps</Badge>}>Demo controls</SectionTitle>
      <p className="text-sm text-muted">
        Demo clock: <span className="font-semibold text-ink">{formatDay(state.clock.now)}</span>
        {state.clock.offset_days > 0 ? ` (+${state.clock.offset_days} days)` : " (today)"}. The real clock is never changed.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={FRONTEND_PREVIEW} busy={busy === "fast-forward"} onClick={() => act("fast-forward", "/api/demo/fast-forward", { days: DEMO_FAST_FORWARD_DAYS })}>
          Fast-forward {DEMO_FAST_FORWARD_DAYS} days
        </Button>
        {!confirmReset ? (
          <Button variant="secondary" onClick={() => setConfirmReset(true)}>
            Reset demo
          </Button>
        ) : (
          <>
            <Button
              variant="danger"
              busy={busy === "reset"}
              onClick={async () => {
                await act("reset", "/api/demo/reset");
                setConfirmReset(false);
              }}
            >
              Yes, reset everything
            </Button>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              Keep data
            </Button>
          </>
        )}
      </div>
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium text-accent">Demo checklist</summary>
        <ol className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {state.steps.map((s) => (
            <li key={s.n} className={s.done ? "text-ink" : "text-muted"}>
              <span className={s.done ? "font-semibold text-success" : ""}>{s.done ? "Done" : "To do"}</span> {s.n}. {s.label}
            </li>
          ))}
        </ol>
      </details>
    </Card>
  );
}

function RunEntry({ run }: { run: AgentRunView }) {
  const { act, busy } = useDemo();
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{TRIGGER_LABEL[run.trigger] ?? run.trigger}</p>
        <div className="flex items-center gap-1.5">
          <SourceBadge source={run.source} />
          {run.status !== "completed" && <StatusBadge status={run.status} />}
          <span className="text-xs text-muted">{formatDayTime(run.created_at)}</span>
        </div>
      </div>
      {run.input_summary && <p className="text-xs text-muted">{run.input_summary}</p>}
      {run.decision && (
        <p className="mt-2 text-sm">
          <span className="font-semibold">Decision:</span> {run.decision}
        </p>
      )}
      {run.decision_factors.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted">
          {run.decision_factors.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      {run.final_output && !run.decision && <p className="mt-1 text-sm text-muted">{run.final_output}</p>}
      {run.decision && run.final_output && (
        <p className="mt-1 text-sm">
          <span className="font-semibold">Action:</span> {run.final_output}
        </p>
      )}
      {run.tools_called.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted">Tools:</span>
          {run.tools_called.map((t, i) => (
            <Badge key={`${t.tool}-${i}`} tone={t.ok ? "neutral" : "danger"} className="font-mono">
              {t.tool}
            </Badge>
          ))}
        </div>
      )}
      {run.status === "failed" && (
        <div className="mt-2 flex items-center gap-2">
          <p className="text-sm text-danger">{run.error}</p>
          {run.event_id && (
            <Button variant="secondary" busy={busy === `retry-${run.id}`} onClick={() => act(`retry-${run.id}`, "/api/agent/run", { event_id: run.event_id })}>
              Retry
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export function YdfView() {
  return (
    <DemoGate>
      {(state) => {
        const m = state.metrics;
        return (
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted">Signed in as (demo)</p>
              <h1 className="text-xl font-semibold">YDF programme dashboard</h1>
            </div>

            <LastError />
            <DemoControls state={state} />

            <section aria-label="Outcomes" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Metric label="Credits used" value={formatNu(m.credits_used)} detail={`of ${formatNu(m.credits_granted)} granted`} />
              <Metric label="Sessions completed" value={String(m.sessions_completed)} />
              <Metric label="Action items completed" value={`${m.actions_completed} / ${m.actions_total}`} />
              <Metric label="Open escalations" value={String(m.open_escalations)} />
            </section>

            <div className="grid gap-4 lg:grid-cols-5">
              <div className="space-y-4 lg:col-span-2">
                <Card>
                  <SectionTitle>Escalation queue</SectionTitle>
                  {state.escalations.length === 0 ? (
                    <p className="text-sm text-muted">No escalations. The agent creates one when someone needs a qualified person.</p>
                  ) : (
                    <ul className="space-y-3">
                      {state.escalations.map((e) => (
                        <li key={e.id} className="rounded-lg border border-line p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-mono text-sm font-semibold">{e.code}</p>
                            <div className="flex gap-1.5">
                              <Badge tone={e.priority === "high" ? "danger" : e.priority === "medium" ? "warning" : "neutral"}>{e.priority} priority</Badge>
                              <StatusBadge status={e.status} />
                            </div>
                          </div>
                          <p className="mt-1 text-sm">
                            <span className="font-medium">{e.entrepreneur_name}</span>
                            {e.action_title ? `: ${e.action_title}` : ""}
                          </p>
                          <p className="mt-1 text-sm text-muted">{e.summary}</p>
                          <p className="mt-2 text-xs text-muted">
                            Opened {formatDayTime(e.created_at)}. Only YDF staff can assign or resolve this.
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                {state.credit && (
                  <Card>
                    <SectionTitle>Sponsorship</SectionTitle>
                    <p className="text-sm">
                      <span className="font-medium">{state.entrepreneur?.full_name}</span>: {formatNu(state.credit.amount_remaining)} of{" "}
                      {formatNu(state.credit.amount_granted)} remaining
                    </p>
                    <p className="mt-1 text-xs text-muted">Approved by YDF staff. The agent cannot approve or change credit.</p>
                  </Card>
                )}
              </div>

              <Card className="lg:col-span-3">
                <SectionTitle aside={<span className="text-xs text-muted">Decision factors only, never hidden reasoning</span>}>
                  Agent activity
                </SectionTitle>
                {state.runs.length === 0 ? (
                  <p className="text-sm text-muted">Nothing yet. Every agent run will appear here with the tools it used.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {state.runs.map((r) => (
                      <RunEntry key={r.id} run={r} />
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        );
      }}
    </DemoGate>
  );
}
