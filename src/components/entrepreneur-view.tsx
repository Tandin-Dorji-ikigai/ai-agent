"use client";

import { useState } from "react";
import { formatDay, formatNu, relativeDue } from "@/lib/format";
import type { DemoState } from "@/lib/state-types";
import { DemoGate, LastError } from "./demo-gate";
import { useDemo } from "./demo-state";
import { AssessmentForm, profileToForm } from "./entrepreneur/assessment-form";
import { Inbox } from "./entrepreneur/inbox";
import { MentorCard, newIdempotencyKey } from "./entrepreneur/mentor-card";
import { Badge, Button, Card, SectionTitle, SourceBadge, StatusBadge } from "./ui";

// Pema's phone. Mobile-first: one narrow column.

function Recommendations({ state, onChangeAnswers }: { state: DemoState; onChangeAnswers: () => void }) {
  const { act, busy } = useDemo();
  if (state.matches.length === 0) {
    return (
      <Card>
        <SectionTitle>Recommended mentors</SectionTitle>
        <p className="text-sm text-muted">Your assessment is saved. Find your mentors when you are ready.</p>
        <Button className="mt-3 w-full" busy={busy === "matching"} onClick={() => act("matching", "/api/matches")}>
          Find my mentors
        </Button>
      </Card>
    );
  }
  const pop = state.most_booked;
  return (
    <section aria-labelledby="recs" className="space-y-3">
      <div>
        <h2 id="recs" className="text-base font-semibold">
          Your three best-matched mentors
        </h2>
        <p className="text-sm text-muted">
          Ranked by fixed rules on expertise, sector, stage, language, availability and budget. The AI only explains the ranking.
        </p>
        <Button variant="ghost" className="-ml-3 mt-1" onClick={onChangeAnswers}>
          Change my answers
        </Button>
      </div>
      {state.matches.map((m) => (
        <MentorCard key={m.mentor.id} match={m} credit={state.credit} />
      ))}
      {pop && pop.rank !== null && pop.rank > 3 && (
        <p className="rounded-lg bg-sunken p-3 text-sm text-muted">
          {pop.mentor.full_name} is the most-booked mentor on the platform ({pop.mentor.sessions_delivered} sessions) but ranks{" "}
          {pop.rank} of {pop.eligible_count} for your needs ({pop.score}/100). Popularity does not affect the ranking.
        </p>
      )}
    </section>
  );
}

/** "Next session": book a follow-up with the same mentor, briefed from progress. */
function FollowUpBooking({ state }: { state: DemoState }) {
  const { act, busy } = useDemo();
  const [key, setKey] = useState(newIdempotencyKey);
  const b = state.booking!;
  const m = b.mentor;
  const useCredit = !!state.credit && state.credit.status === "active" && state.credit.amount_remaining >= m.fee;
  if (m.slots_remaining < 1) return <p className="mt-3 text-sm text-muted">{m.full_name} has no open sessions right now.</p>;
  return (
    <div className="mt-4 border-t border-line pt-4">
      <p className="text-sm text-muted">
        {m.full_name.split(" ")[0]} will be briefed with your progress since this session.{" "}
        {useCredit ? `Uses ${formatNu(m.fee)} of your YDF credit.` : `Self-paid (simulated), ${formatNu(m.fee)}.`}
      </p>
      <Button
        className="mt-2 w-full"
        variant="secondary"
        busy={busy === "follow-up"}
        onClick={async () => {
          const res = await act("follow-up", "/api/booking", {
            mentor_id: m.id,
            funding_type: useCredit ? "ydf_credit" : "self_paid",
            idempotency_key: key,
          });
          if (!res.ok) setKey(newIdempotencyKey());
        }}
      >
        Book a follow-up with {m.full_name.split(" ")[0]}
      </Button>
    </div>
  );
}

function SessionCard({ state }: { state: DemoState }) {
  const b = state.booking!;
  const brief = b.entrepreneur_brief;
  return (
    <Card>
      <SectionTitle aside={<StatusBadge status={b.status === "completed" ? "completed" : "pending"} />}>
        {b.status === "completed" ? "Your session" : "Your next session"}
      </SectionTitle>
      <p className="text-sm">
        <span className="font-semibold">{b.mentor.full_name}</span>, {formatDay(b.scheduled_at)}
      </p>
      <p className="text-sm text-muted">
        {formatNu(b.fee)}, {b.funding_type === "ydf_credit" ? "paid with YDF credit" : "self-paid (simulated)"}
      </p>
      {brief && b.status !== "completed" && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Before your session</h3>
            <SourceBadge source={b.brief_source} />
          </div>
          <ul className="space-y-2">
            {brief.prepare.map((p) => (
              <li key={p} className="flex gap-2 text-sm">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
          <h3 className="text-sm font-semibold">Questions to ask</h3>
          <ul className="space-y-2">
            {brief.questions_to_ask.map((q) => (
              <li key={q} className="rounded-lg bg-sunken px-3 py-2 text-sm">
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}
      {b.status === "completed" && state.actions.some((a) => a.status === "draft") && (
        <p className="mt-3 text-sm text-muted">{b.mentor.full_name.split(" ")[0]} is reviewing the actions from your session.</p>
      )}
      {b.status === "completed" && state.session?.summary_confirmed && <FollowUpBooking state={state} />}
    </Card>
  );
}

function Actions({ state }: { state: DemoState }) {
  const { act, busy } = useDemo();
  const actions = state.actions.filter((a) => a.status !== "draft");
  if (actions.length === 0) return null;
  return (
    <Card>
      <SectionTitle>Your actions</SectionTitle>
      <ul className="divide-y divide-line">
        {actions.map((a) => (
          <li key={a.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div>
              <p className="text-sm font-medium">{a.title}</p>
              {a.success_measure && <p className="text-xs text-muted">Done when: {a.success_measure}</p>}
              <p className="text-xs text-muted">
                {a.status === "completed" ? "Done" : relativeDue(a.due_at, state.clock.now)}
                {a.next_check_in_at && a.status !== "completed" ? `. Next check-in ${formatDay(a.next_check_in_at)}` : ""}
              </p>
              {a.blocker && <p className="mt-1 text-xs text-muted">Blocked: {a.blocker}</p>}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <StatusBadge status={a.status} />
              {a.status !== "completed" && (
                <Button
                  variant="ghost"
                  className="min-h-9 px-2 py-1 text-xs"
                  busy={busy === `done-${a.id}`}
                  onClick={() => act(`done-${a.id}`, "/api/actions/status", { action_id: a.id, status: "completed" })}
                >
                  Mark done
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function EntrepreneurBody({ state }: { state: DemoState }) {
  const [editing, setEditing] = useState(false);
  const e = state.entrepreneur!;
  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Signed in as (demo)</p>
          <h1 className="text-xl font-semibold">{e.full_name}</h1>
          <p className="text-sm text-muted">{e.business_name}</p>
        </div>
        {state.credit && (
          <Badge tone="accent" className="mt-1 shrink-0">
            YDF credit {formatNu(state.credit.amount_remaining)}
          </Badge>
        )}
      </div>

      <LastError />

      {!e.assessment_completed_at ? (
        <AssessmentForm />
      ) : editing && !state.booking ? (
        <>
          <AssessmentForm initial={profileToForm(e)} onDone={() => setEditing(false)} heading="Change your answers" />
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Keep my answers
          </Button>
        </>
      ) : (
        <>
          {state.messages.length > 0 && <Inbox state={state} />}
          {state.booking ? <SessionCard state={state} /> : <Recommendations state={state} onChangeAnswers={() => setEditing(true)} />}
          <Actions state={state} />
          {e.assessment_summary && (
            <details className="rounded-xl border border-line bg-card p-4">
              <summary className="cursor-pointer text-sm font-semibold">What the agent knows about you</summary>
              <p className="mt-2 text-sm text-muted">{e.assessment_summary}</p>
            </details>
          )}
        </>
      )}
    </div>
  );
}

export function EntrepreneurView() {
  return <DemoGate>{(state) => <EntrepreneurBody state={state} />}</DemoGate>;
}
