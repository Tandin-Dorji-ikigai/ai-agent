"use client";

import { useState } from "react";
import { DEMO_SESSION_NOTES } from "@/lib/demo/fixtures";
import { formatDayTime, formatNu, relativeDue } from "@/lib/format";
import { formatBhutanDay, formatSlot } from "@/lib/matching/slots";
import type { AgendaItem, DemoState, MentorRequestView, ProgressView } from "@/lib/state-types";
import { DECLINE_REASON_LABEL, DECLINE_REASONS, expertiseLabel, LANGUAGE_LABEL, sectorLabel, stageLabel, type DeclineReason } from "@/lib/types";
import { DemoGate, LastError } from "./demo-gate";
import { VoiceNote } from "./mentor/voice-note";
import { useDemo } from "./demo-state";
import { Badge, Button, Card, ChoiceChips, Notice, SectionTitle, SourceBadge, StatusBadge, inputClass } from "./ui";

// The mentor's side: less coordination, more guidance. A brief arrives,
// they talk, they leave short notes, and the agent does the rest.

/** A request from the agent: the mentor decides, and picks the time. */
function RequestCard({ req, now }: { req: MentorRequestView; now: string }) {
  const { act, busy } = useDemo();
  const times = req.offered_slots.filter((t) => new Date(t).getTime() > new Date(now).getTime());
  const [slot, setSlot] = useState(times[0] ?? "");
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<DeclineReason>("no_time");
  const [note, setNote] = useState("");
  const s = req.mentee_summary;
  const mentee = s.full_name.split(" ")[0];
  const noteId = `decline-note-${req.id}`;

  return (
    <Card>
      <SectionTitle aside={<Badge tone="accent">{s.follow_up ? "Follow-up request" : "New request"}</Badge>}>
        {s.follow_up ? `${s.full_name} asks for a follow-up session` : `${s.full_name} would like you as a mentor`}
      </SectionTitle>
      <p className="text-sm text-muted">
        Sent by the mentoring agent. Please reply by {formatBhutanDay(req.expires_at)}; after that the agent asks another mentor.
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {s.business_stage && <Badge>{stageLabel(s.business_stage)}</Badge>}
        {s.sector && <Badge>{sectorLabel(s.sector)}</Badge>}
        {s.location && <Badge>{s.location}</Badge>}
        <Badge>Prefers {LANGUAGE_LABEL[s.preferred_language]}</Badge>
      </div>

      <dl className="mt-3 space-y-2 text-sm">
        {s.business_name && (
          <div>
            <dt className="font-semibold">Business</dt>
            <dd className="text-muted">{s.business_name}</dd>
          </div>
        )}
        <div>
          <dt className="font-semibold">Needs help with</dt>
          <dd className="text-muted">{s.needs.join(", ")}</dd>
        </div>
        {s.challenge && (
          <div>
            <dt className="font-semibold">Main challenge, in {mentee}&apos;s words</dt>
            <dd className="text-muted">{s.challenge}</dd>
          </div>
        )}
        {s.why.length > 0 && (
          <div>
            <dt className="font-semibold">Why the agent asked you{req.score !== null ? ` (${req.score}/100)` : ""}</dt>
            <dd>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
                {s.why.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        <div>
          <dt className="font-semibold">Fee</dt>
          <dd className="text-muted">
            {formatNu(req.fee)}, {req.funding_type === "ydf_credit" ? "paid with YDF credit when you accept" : "self-paid (simulated)"}
          </dd>
        </div>
      </dl>

      {!declining ? (
        <div className="mt-4 space-y-3">
          {times.length > 0 ? (
            <ChoiceChips
              legend="Pick a time from your usual hours (Bhutan time)"
              name={`slot-${req.id}`}
              options={times.map((t) => ({ value: t, label: formatSlot(t) }))}
              value={slot}
              onChange={setSlot}
            />
          ) : (
            <Notice tone="warning">All the offered times have passed. Decline, and the agent will ask another mentor.</Notice>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              busy={busy === "accept"}
              disabled={!slot}
              onClick={() => act("accept", "/api/requests/accept", { request_id: req.id, scheduled_at: slot })}
            >
              {slot ? `Accept for ${formatSlot(slot)}` : "Accept"}
            </Button>
            <Button variant="secondary" onClick={() => setDeclining(true)}>
              Decline
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void act("decline", "/api/requests/decline", { request_id: req.id, reason, note: note.trim() || undefined });
          }}
        >
          <ChoiceChips
            legend="Why can you not take this on?"
            name={`reason-${req.id}`}
            options={DECLINE_REASONS.map((r) => ({ value: r, label: DECLINE_REASON_LABEL[r] }))}
            value={reason}
            onChange={(v) => setReason(v as DeclineReason)}
          />
          <div>
            <label htmlFor={noteId} className="mb-1 block text-sm font-medium">
              Note for the agent and YDF (optional)
            </label>
            <textarea id={noteId} rows={2} maxLength={300} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <p className="text-xs text-muted">
            {mentee} is told the reason you pick, not your note, and the agent asks the next best mentor.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" busy={busy === "decline"}>
              Send decline
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDeclining(false)}>
              Back
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

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

/** Shown after a session ends until its draft actions appear (long calls are read in the background). */
function ReadingNotice({ state }: { state: DemoState }) {
  const run = state.runs.find((r) => r.trigger === "session.completed");
  if (run?.status === "running" || !run) {
    return (
      <Notice tone="info" title="The agent is reading the session">
        Long call transcripts are read in parts to stay within the free AI limits, so this can take a minute or two. Draft actions
        will appear here.
      </Notice>
    );
  }
  if (run.status === "failed") {
    return (
      <Notice tone="danger" title="The agent could not read the session">
        Retry it from the agent activity log in the YDF view.
      </Notice>
    );
  }
  return (
    <Notice tone="warning" title="No clear actions found">
      {state.session?.agent_summary ?? "The agent found no agreed actions. Add them by hand if the session agreed any."}
    </Notice>
  );
}

export function MentorView() {
  return (
    <DemoGate>
      {(state) => {
        const mentor = state.mentor_for_view;
        const req = state.pending_request && state.pending_request.mentor.id === mentor?.id ? state.pending_request : null;
        // Only this mentor's own booking (a request may now be with someone else).
        const b = state.booking && state.booking.mentor.id === mentor?.id ? state.booking : null;
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

            {req && <RequestCard key={req.id} req={req} now={state.clock.now} />}

            {!b ? (
              !req && (
                <Card>
                  <SectionTitle>No requests or sessions yet</SectionTitle>
                  <p className="text-sm text-muted">
                    When the agent matches an entrepreneur to you, their request appears here. You decide: accept with one of your usual
                    times, or decline. You will not need to chase context or schedules.
                  </p>
                </Card>
              )
            ) : (
              <>
                <Card>
                  <SectionTitle aside={<SourceBadge source={b.brief_source} />}>Brief for your session</SectionTitle>
                  <p className="text-sm">
                    <span className="font-semibold">{state.entrepreneur?.full_name}</span>, {formatSlot(b.scheduled_at)}.{" "}
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
                {state.session?.completed_at && !state.actions.some((a) => a.session_id === state.session?.id) && (
                  <ReadingNotice state={state} />
                )}
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
