"use client";

import { useState } from "react";
import { DEMO_SESSION_NOTES } from "@/lib/demo/fixtures";
import { formatDay, formatDayTime, formatNu, relativeDue } from "@/lib/format";
import type { AgendaItem, DemoState, ProgressView } from "@/lib/state-types";
import { expertiseLabel, LANGUAGE_LABEL } from "@/lib/types";
import { DemoGate, LastError } from "./demo-gate";
import { VoiceNote } from "./mentor/voice-note";
import { useDemo } from "./demo-state";
import { Badge, Button, Card, Notice, SectionTitle, SourceBadge, StatusBadge, inputClass } from "./ui";

// The mentor's side: less coordination, more guidance. A brief arrives,
// they talk, they leave short notes, and the agent does the rest.

function NotesForm({ state }: { state: DemoState }) {
  const { act, busy } = useDemo();
  const [notes, setNotes] = useState(DEMO_SESSION_NOTES);
  const [source, setSource] = useState<"typed" | "voice_note">("typed");
  return (
    <Card>
      <SectionTitle>After the session: quick notes</SectionTitle>
      <p className="mb-3 text-sm text-muted">Write as you would in a notebook. The agent turns agreed points into draft actions for you to check.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act("notes", "/api/session/complete", { booking_id: state.booking!.id, notes, source });
        }}
        className="space-y-3"
      >
        <label htmlFor="notes" className="sr-only">
          Session notes
        </label>
        <textarea id="notes" rows={8} className={`${inputClass} font-mono`} value={notes} onChange={(e) => setNotes(e.target.value)} required />
        <VoiceNote
          available={state.ai_mode === "live"}
          onText={(text) => {
            setNotes((n) => (n === DEMO_SESSION_NOTES || !n.trim() ? text : `${n.trim()}\n${text}`));
            setSource("voice_note");
          }}
        />
        <Button type="submit" busy={busy === "notes"}>
          {busy === "notes" ? "Extracting actions..." : "Complete session"}
        </Button>
      </form>
    </Card>
  );
}

const NOTES_SOURCE_LABEL = { typed: "typed notes", voice_note: "voice note", call_recording: "call recording" } as const;

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
      <SectionTitle
        aside={
          <span className="flex items-center gap-1.5">
            {state.session && <Badge>From {NOTES_SOURCE_LABEL[state.session.notes_source]}</Badge>}
            <SourceBadge source={state.session?.summary_source} />
          </span>
        }
      >
        Check the agent&apos;s draft actions
      </SectionTitle>
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
                {d.success_measure ? (
                  <span className="block text-muted">Done when: {d.success_measure}</span>
                ) : (
                  <Badge tone="warning" className="mt-1">
                    No measure of success yet
                  </Badge>
                )}
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

const PROGRESS_LABEL: Record<ProgressView["kind"], [string, "success" | "info" | "warning" | "danger" | "accent" | "neutral"]> = {
  on_track: ["On track", "info"],
  done: ["Done", "success"],
  obstacle: ["Obstacle", "warning"],
  help_requested: ["Needs help", "warning"],
  resource_recommended: ["Resource sent", "neutral"],
  mentor_requested: ["Asked you for help", "accent"],
  mentor_session_suggested: ["Other mentor suggested", "neutral"],
  escalated: ["Escalated to YDF", "danger"],
};

const AGENDA_TONE: Record<AgendaItem["kind"], "success" | "info" | "warning" | "danger" | "accent" | "neutral"> = {
  help: "accent",
  escalated: "danger",
  obstacle: "warning",
  overdue: "danger",
  blocked: "warning",
  on_track: "info",
  done: "success",
};

const AGENDA_LABEL: Record<AgendaItem["kind"], string> = {
  help: "Help asked",
  escalated: "With YDF",
  obstacle: "Obstacle",
  overdue: "Overdue",
  blocked: "Blocked",
  on_track: "On track",
  done: "Done",
};

/** "Add to mentor progress": what happened between sessions, newest first. */
function ProgressFeed({ state }: { state: DemoState }) {
  const items = [...state.progress].reverse();
  return (
    <Card>
      <SectionTitle>Progress since your session</SectionTitle>
      {items.length === 0 ? (
        <p className="text-sm text-muted">Nothing yet. The agent checks in before each due date and records every reply here.</p>
      ) : (
        <ol className="space-y-3">
          {items.map((p) => {
            const [label, tone] = PROGRESS_LABEL[p.kind];
            return (
              <li key={p.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge tone={tone}>{label}</Badge>
                  <span className="text-xs text-muted">{formatDayTime(p.created_at)}</span>
                </div>
                {p.action_title && <p className="mt-1 text-sm font-medium">{p.action_title}</p>}
                {p.note && <p className="text-sm text-muted">{p.note}</p>}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

/** "Next session": what to cover, built from progress. */
function Agenda({ state }: { state: DemoState }) {
  return (
    <Card>
      <SectionTitle>Agenda for your next session</SectionTitle>
      {state.agenda.length === 0 ? (
        <p className="text-sm text-muted">Items appear here as the agent checks in with {state.entrepreneur?.full_name.split(" ")[0] ?? "your mentee"}.</p>
      ) : (
        <ul className="space-y-2">
          {state.agenda.map((a, i) => (
            <li key={`${a.kind}-${a.action_id}-${i}`} className="flex items-start gap-2 text-sm">
              <Badge tone={AGENDA_TONE[a.kind]} className="mt-0.5 shrink-0">
                {AGENDA_LABEL[a.kind]}
              </Badge>
              <span>{a.text}</span>
            </li>
          ))}
        </ul>
      )}
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
                            {a.success_measure && <p className="text-xs text-muted">Done when: {a.success_measure}</p>}
                            <p className="text-xs text-muted">{a.status === "completed" ? "Done" : relativeDue(a.due_at, state.clock.now)}</p>
                            {a.blocker && <p className="mt-1 text-xs text-muted">Blocker: {a.blocker}</p>}
                          </div>
                          <StatusBadge status={a.status} />
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                {confirmed.length > 0 && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <Agenda state={state} />
                    <ProgressFeed state={state} />
                  </div>
                )}
              </>
            )}
          </div>
        );
      }}
    </DemoGate>
  );
}
