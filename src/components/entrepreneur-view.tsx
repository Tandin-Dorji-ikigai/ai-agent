"use client";

import { useEffect, useRef, useState } from "react";
import { formatDay, formatNu, relativeDue } from "@/lib/format";
import { formatBhutanDay, formatSlot } from "@/lib/matching/slots";
import type { DemoState, MentorRequestView } from "@/lib/state-types";
import { DECLINE_REASON_LABEL } from "@/lib/types";
import { DemoGate, LastError } from "./demo-gate";
import { useDemo } from "./demo-state";
import { AssessmentForm, profileToForm } from "./entrepreneur/assessment-form";
import { Inbox } from "./entrepreneur/inbox";
import { MentorCard, type RequestChip } from "./entrepreneur/mentor-card";
import { Badge, Button, Card, Notice, SectionTitle, SourceBadge, StatusBadge } from "./ui";

// Pema's phone. Mobile-first: one narrow column.

const firstName = (full: string) => full.split(" ")[0];

/** One line per mentor the agent asked, newest last. */
function requestOutcome(r: MentorRequestView): string {
  switch (r.status) {
    case "pending":
      return `Deciding, reply due ${formatBhutanDay(r.expires_at)}`;
    case "accepted":
      return `Accepted: ${formatSlot(r.scheduled_at)}`;
    case "declined":
      return `Declined: ${r.decline_reason ? DECLINE_REASON_LABEL[r.decline_reason].toLowerCase() : "no reason given"}`;
    case "expired":
      return "No reply in time";
    default:
      return "Request cancelled";
  }
}

const OUTCOME_TONE: Record<MentorRequestView["status"], "info" | "success" | "neutral"> = {
  pending: "info",
  accepted: "success",
  declined: "neutral",
  expired: "neutral",
  cancelled: "neutral",
};

/** "Your mentor request": the agent asks, the mentor decides, the mentee is kept informed. */
function RequestStatus({ state, stalled }: { state: DemoState; stalled: boolean }) {
  const round = state.request_round!;
  const current = round.requests.find((r) => r.status === "pending");
  const label = { waiting: "Waiting for a reply", accepted: "Booked", escalated: "With YDF", stopped: "Stopped" }[round.status];
  const tone = { waiting: "info", accepted: "success", escalated: "warning", stopped: "neutral" } as const;
  return (
    <Card>
      <SectionTitle aside={<Badge tone={tone[round.status]}>{label}</Badge>}>Your mentor request</SectionTitle>
      {round.status === "waiting" && current && (
        <div className="space-y-2 text-sm">
          <p>
            I have asked <span className="font-semibold">{current.mentor.full_name}</span>
            {round.kind === "direct"
              ? current.mentee_summary.follow_up
                ? " for a follow-up session"
                : " for a session"
              : current.attempt === 1
                ? ", your best match,"
                : ", your next best match,"}{" "}
            and am waiting for a reply by {formatBhutanDay(current.expires_at)}.
          </p>
          <p className="text-muted">
            {firstName(current.mentor.full_name)} sees a short summary of your needs, not your phone number. If{" "}
            {firstName(current.mentor.full_name)} accepts, the session ({formatNu(current.fee)}) is{" "}
            {current.funding_type === "ydf_credit" ? "paid with your YDF credit" : "self-paid (simulated)"}. Nothing is booked or paid
            before that.
          </p>
          {round.next_mentor && (
            <p className="text-muted">
              If {firstName(current.mentor.full_name)} cannot, I will ask {round.next_mentor.mentor.full_name} next.
            </p>
          )}
        </div>
      )}
      {round.status === "escalated" && (
        <Notice tone="warning" title="YDF is helping you find a mentor">
          {round.requests.length > 0
            ? `None of the mentors I asked can take you on right now, so a YDF programme officer will help (${round.escalation_code}).`
            : `No available mentor fits your needs well enough right now, so a YDF programme officer will help (${round.escalation_code}).`}
        </Notice>
      )}
      {round.status === "stopped" &&
        (stalled ? (
          <p className="text-sm text-muted">{STALLED}</p>
        ) : (
          <AgentWorking text="The request stopped before a mentor said yes. I am picking it up again." />
        ))}
      {round.requests.length > 0 && (
        <ol className="mt-3 space-y-2" aria-label="Mentors asked">
          {round.requests.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
              <span className="font-medium">{r.mentor.full_name}</span>
              <Badge tone={OUTCOME_TONE[r.status]}>{requestOutcome(r)}</Badge>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** A short "the agent is on it" line, announced politely to screen readers. */
function AgentWorking({ text }: { text: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted">
      <span className="size-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
      {text}
    </p>
  );
}

const AUTO_TRIES = 3;
const AUTO_RETRY_MS = 5000;

/**
 * The agent keeps going by itself: whenever there are matches but no mentor is
 * being asked (older data, or a step that failed), it asks the best match.
 * No button, and no error banner for work the person did not start: it retries
 * quietly (3 tries), then says calmly that it will try again later.
 * The server ignores repeats.
 */
function useAutoRequest(state: DemoState, editing: boolean): { asking: boolean; stalled: boolean } {
  const { refresh } = useDemo();
  const round = state.request_round;
  const needed =
    !editing && !!state.entrepreneur?.assessment_completed_at && state.matches.length > 0 && !state.booking && (!round || round.status === "stopped");
  const key = needed ? `${state.entrepreneur?.assessment_completed_at}:${round?.round_id ?? "none"}:${round?.requests.at(-1)?.id ?? ""}` : null;
  const tries = useRef(new Map<string, number>());
  const [retry, setRetry] = useState(0);
  const [stalledKey, setStalledKey] = useState<string | null>(null);

  useEffect(() => {
    if (!key || stalledKey === key) return;
    const n = tries.current.get(key) ?? 0;
    if (n >= AUTO_TRIES) return;
    // Counted when it fires, so React's development double-run does not use up a try.
    const timer = setTimeout(() => {
      tries.current.set(key, n + 1);
      fetch("/api/requests/start", { method: "POST" })
        .then((res) => res.json())
        .then((json: { ok: boolean }) => {
          if (!json.ok) throw new Error("start failed");
          return refresh();
        })
        .catch(() => (n + 1 >= AUTO_TRIES ? setStalledKey(key) : setRetry((r) => r + 1)));
    }, n === 0 ? 0 : AUTO_RETRY_MS);
    return () => clearTimeout(timer);
  }, [key, retry, stalledKey, refresh]);

  return { asking: needed, stalled: !!key && stalledKey === key };
}

const STALLED = "I could not reach a mentor just now. I will try again when you next open this page.";

/** Matches exist and the agent is about to ask the best one. */
function AskingNow({ stalled }: { stalled: boolean }) {
  return (
    <Card>
      <SectionTitle>Your mentor request</SectionTitle>
      {stalled ? (
        <p className="text-sm text-muted">{STALLED}</p>
      ) : (
        <AgentWorking text="I am asking your best-matched mentor now. That mentor decides." />
      )}
    </Card>
  );
}

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
  const round = state.request_round;
  const chipFor = (mentorId: string): RequestChip | undefined => {
    const r = round?.requests.find((x) => x.mentor.id === mentorId);
    if (r) return r.status;
    return round?.next_mentor?.mentor.id === mentorId ? "next" : undefined;
  };
  return (
    <section aria-labelledby="recs" className="space-y-3">
      <div>
        <h2 id="recs" className="text-base font-semibold">
          Your three best-matched mentors
        </h2>
        <p className="text-sm text-muted">
          Ranked by fixed rules on expertise, sector, stage, language, availability and budget. The AI only explains the ranking. The
          agent asks them in this order, and each mentor decides.
        </p>
        <Button variant="ghost" className="-ml-3 mt-1" onClick={onChangeAnswers}>
          Change my answers
        </Button>
      </div>
      {state.matches.map((m) => (
        <MentorCard key={m.mentor.id} match={m} chip={chipFor(m.mentor.id)} />
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

/** "Next session": ask the same mentor for a follow-up, briefed from progress. The mentor decides. */
function FollowUpRequest({ state }: { state: DemoState }) {
  const { act, busy } = useDemo();
  const b = state.booking!;
  const m = b.mentor;
  const first = firstName(m.full_name);
  if (state.request_round?.status === "waiting") return null;
  if (m.slots_remaining < 1) return <p className="mt-3 text-sm text-muted">{m.full_name} has no open sessions right now.</p>;
  const useCredit = !!state.credit && state.credit.status === "active" && state.credit.amount_remaining >= m.fee;
  return (
    <div className="mt-4 border-t border-line pt-4">
      <p className="text-sm text-muted">
        {first} will be briefed with your progress since this session.{" "}
        {useCredit ? `Uses ${formatNu(m.fee)} of your YDF credit if ${first} accepts.` : `Self-paid (simulated), ${formatNu(m.fee)}, if ${first} accepts.`}
      </p>
      <Button
        className="mt-2 w-full"
        variant="secondary"
        busy={busy === "follow-up"}
        onClick={() => act("follow-up", "/api/requests/ask", { mentor_id: m.id })}
      >
        Ask {first} for a follow-up
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
        <span className="font-semibold">{b.mentor.full_name}</span>, {formatSlot(b.scheduled_at)}
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
      {b.status === "completed" && state.session?.summary_confirmed && <FollowUpRequest state={state} />}
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
  const auto = useAutoRequest(state, editing);
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
          {state.request_round && state.request_round.status !== "accepted" && <RequestStatus state={state} stalled={auto.stalled} />}
          {auto.asking && !state.request_round && <AskingNow stalled={auto.stalled} />}
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
