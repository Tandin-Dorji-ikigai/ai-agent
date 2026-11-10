"use client";

import { useState } from "react";
import { DEMO_SESSION_NOTES } from "@/lib/demo/fixtures";
import { formatDay, formatNu, relativeDue } from "@/lib/format";
import type { DemoState } from "@/lib/state-types";
import { expertiseLabel, LANGUAGE_LABEL } from "@/lib/types";
import { DemoGate, LastError } from "./demo-gate";
import { useDemo } from "./demo-state";
import { Badge, Button, Card, Notice, SectionTitle, SourceBadge, StatusBadge, inputClass } from "./ui";

// The mentor's side: less coordination, more guidance. A brief arrives,
// they talk, they leave short notes, and the agent does the rest.

function NotesForm({ state }: { state: DemoState }) {
  const { act, busy } = useDemo();
  const [notes, setNotes] = useState(DEMO_SESSION_NOTES);
  return (
    <Card>
      <SectionTitle>After the session: quick notes</SectionTitle>
      <p className="mb-3 text-sm text-muted">Write as you would in a notebook. The agent turns agreed points into draft actions for you to check.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act("notes", "/api/session/complete", { booking_id: state.booking!.id, notes });
        }}
        className="space-y-3"
      >
        <label htmlFor="notes" className="sr-only">
          Session notes
        </label>
        <textarea id="notes" rows={8} className={`${inputClass} font-mono`} value={notes} onChange={(e) => setNotes(e.target.value)} required />
        <Button type="submit" busy={busy === "notes"}>
          {busy === "notes" ? "Extracting actions..." : "Complete session"}
        </Button>
      </form>
    </Card>
  );
}

function DraftReview({ state }: { state: DemoState }) {
  const { act, busy } = useDemo();
  const drafts = state.actions.filter((a) => a.status === "draft");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(drafts.map((d) => d.id)));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Card>
      <SectionTitle aside={<SourceBadge source={state.session?.summary_source} />}>Check the agent&apos;s draft actions</SectionTitle>
      {state.session?.agent_summary && <p className="mb-3 text-sm text-muted">{state.session.agent_summary}</p>}
      <Notice tone="warning">Nothing is saved as an action until you confirm. Untick anything that is wrong.</Notice>
      <ul className="mt-3 space-y-2">
        {drafts.map((d) => (
          <li key={d.id}>
            <label className="flex min-h-11 items-start gap-3 rounded-lg border border-line p-3">
              <input type="checkbox" className="mt-0.5 size-4 accent-accent" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
              <span className="text-sm">
                <span className="font-medium">{d.title}</span>
                {d.description && <span className="block text-muted">{d.description}</span>}
                <span className="block text-xs text-muted">
                  Owner: {d.owner}, due {d.due_in_days} days after confirmation
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <Button
        className="mt-3"
        busy={busy === "confirm"}
        onClick={() => act("confirm", "/api/actions/confirm", { session_id: state.session!.id, action_ids: [...selected] })}
      >
        Confirm {selected.size} action{selected.size === 1 ? "" : "s"}
      </Button>
    </Card>
  );
}

export function MentorView() {
  return (
    <DemoGate>
      {(state) => {
        const mentor = state.mentor_for_view;
        const b = state.booking;
        const confirmed = state.actions.filter((a) => a.status !== "draft");
        const hasDrafts = state.actions.some((a) => a.status === "draft");

        return (
          <div className="mx-auto max-w-3xl space-y-4">
            <div>
              <p className="text-sm text-muted">Signed in as (demo)</p>
              <h1 className="text-xl font-semibold">{mentor ? mentor.full_name : "Mentor"}</h1>
              {mentor && (
                <p className="text-sm text-muted">
                  {mentor.headline}. {mentor.expertise.map(expertiseLabel).join(", ")}.
                </p>
              )}
            </div>

            <LastError />

            {!b ? (
              <Card>
                <SectionTitle>No sessions booked yet</SectionTitle>
                <p className="text-sm text-muted">When an entrepreneur books you, their brief appears here. You will not need to chase context or schedules.</p>
              </Card>
            ) : (
              <>
                <Card>
                  <SectionTitle aside={<SourceBadge source={b.brief_source} />}>Brief for your session</SectionTitle>
                  <p className="text-sm">
                    <span className="font-semibold">{state.entrepreneur?.full_name}</span>, {formatDay(b.scheduled_at)}.{" "}
                    {formatNu(b.fee)}, {b.funding_type === "ydf_credit" ? "funded by YDF credit" : "self-paid"}.
                  </p>
                  {state.entrepreneur && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge>Prefers {LANGUAGE_LABEL[state.entrepreneur.preferred_language]}</Badge>
                      {state.entrepreneur.location && <Badge>{state.entrepreneur.location}</Badge>}
                    </div>
                  )}
                  {b.mentor_brief ? (
                    <div className="mt-4 space-y-3">
                      <h3 className="text-sm font-semibold">{b.mentor_brief.headline}</h3>
                      <p className="text-sm text-muted">{b.mentor_brief.about}</p>
                      <div>
                        <h4 className="text-sm font-semibold">Suggested focus</h4>
                        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                          {b.mentor_brief.focus.map((f) => (
                            <li key={f}>{f}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted">The brief is being prepared.</p>
                  )}
                </Card>

                {!state.session?.completed_at && <NotesForm state={state} />}
                {hasDrafts && <DraftReview key={state.session?.id} state={state} />}

                {confirmed.length > 0 && (
                  <Card>
                    <SectionTitle>Agreed actions (tracked by the agent)</SectionTitle>
                    <ul className="divide-y divide-line">
                      {confirmed.map((a) => (
                        <li key={a.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                          <div>
                            <p className="text-sm font-medium">{a.title}</p>
                            <p className="text-xs text-muted">{a.status === "completed" ? "Done" : relativeDue(a.due_at, state.clock.now)}</p>
                            {a.blocker && <p className="mt-1 text-xs text-muted">Blocker: {a.blocker}</p>}
                          </div>
                          <StatusBadge status={a.status} />
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </>
            )}
          </div>
        );
      }}
    </DemoGate>
  );
}
