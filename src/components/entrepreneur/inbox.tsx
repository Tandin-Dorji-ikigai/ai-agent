"use client";

import { useState } from "react";
import { demoReplyFor } from "@/lib/demo/fixtures";
import { formatDayTime } from "@/lib/format";
import type { DemoState, MessageView } from "@/lib/state-types";
import { useDemo } from "../demo-state";
import { Badge, Button, Card, SectionTitle, SourceBadge, inputClass } from "../ui";

// The agent inbox: how the agent reaches the entrepreneur between sessions.
// Check-ins and overdue follow-ups each get their own reply box.

function AgentMessage({ m }: { m: MessageView }) {
  const isFollowUp = m.kind === "follow_up";
  const escalationCode = typeof m.metadata.escalation_code === "string" ? m.metadata.escalation_code : null;
  return (
    <div className="max-w-[90%] rounded-2xl rounded-tl-sm bg-sunken px-3 py-2">
      {m.body_dz && m.dz_verified ? (
        <>
          <p lang="dz" className="text-base">
            {m.body_dz}
          </p>
          <p className="mt-1 border-t border-line pt-1 text-sm text-muted">English: {m.body}</p>
        </>
      ) : (
        <p className="whitespace-pre-line text-sm">{m.body}</p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted">{formatDayTime(m.created_at)}</span>
        {m.kind === "check_in" && <Badge tone="info">Check-in</Badge>}
        {isFollowUp && <Badge tone="danger">Overdue</Badge>}
        {m.kind === "recommendation" && <Badge tone="accent">Suggestion</Badge>}
        {escalationCode && <Badge tone="warning">Escalated: {escalationCode}</Badge>}
        {isFollowUp && !m.dz_verified && <Badge>Dzongkha version pending review</Badge>}
        <SourceBadge source={m.source} />
      </div>
    </div>
  );
}

/** The agent suggested another mentor: the mentee can ask the agent to send them a request. */
function SuggestedSession({ m, state }: { m: MessageView; state: DemoState }) {
  const { act, busy } = useDemo();
  const mentorId = typeof m.metadata.mentor_id === "string" ? m.metadata.mentor_id : null;
  if (!mentorId) return null;
  const asked = state.request_round?.requests.some((r) => r.mentor.id === mentorId && r.created_at >= m.created_at);
  if (asked) return null;
  const waiting = state.request_round?.status === "waiting";
  return (
    <div className="mt-2">
      <Button
        variant="secondary"
        busy={busy === `ask-${m.id}`}
        disabled={waiting}
        onClick={() => act(`ask-${m.id}`, "/api/requests/ask", { mentor_id: mentorId })}
      >
        Yes, ask for a session
      </Button>
      {waiting && <p className="mt-1 text-xs text-muted">You can ask once your open mentor request has an answer.</p>}
    </div>
  );
}

function ReplyBox({ m, actionTitle }: { m: MessageView; actionTitle: string | undefined }) {
  const { act, busy } = useDemo();
  const [reply, setReply] = useState(() => demoReplyFor(actionTitle, m.kind));
  const id = `reply-${m.id}`;
  return (
    <form
      className="mt-2 w-full space-y-2 rounded-xl border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void act(id, "/api/inbox/reply", { message_id: m.id, body: reply });
      }}
    >
      <label htmlFor={id} className="block text-sm font-medium">
        Reply about {actionTitle ? `"${actionTitle}"` : "this"}
      </label>
      <textarea id={id} rows={3} className={inputClass} value={reply} onChange={(e) => setReply(e.target.value)} required />
      <Button type="submit" className="w-full" busy={busy === id}>
        {busy === id ? "The agent is reading your reply..." : "Send reply"}
      </Button>
    </form>
  );
}

export function Inbox({ state }: { state: DemoState }) {
  const waiting = state.messages.filter((m) => m.awaiting_reply).length;
  const titleOf = (id: string | null) => state.actions.find((a) => a.id === id)?.title;

  return (
    <Card>
      <SectionTitle aside={waiting > 0 ? <Badge tone="danger">{waiting === 1 ? "1 needs your reply" : `${waiting} need your reply`}</Badge> : undefined}>
        Messages from your mentoring agent
      </SectionTitle>
      {state.messages.length === 0 ? (
        <p className="text-sm text-muted">No messages yet. The agent will write here when it books, prepares or checks in.</p>
      ) : (
        <ol className="space-y-3" aria-live="polite">
          {state.messages.map((m) => (
            <li key={m.id} className={m.sender === "entrepreneur" ? "flex justify-end" : "flex flex-col items-start"}>
              {m.sender === "entrepreneur" ? (
                <div className="max-w-[90%] rounded-2xl rounded-tr-sm bg-accent-soft px-3 py-2">
                  <p className="text-sm">{m.body}</p>
                  <p className="mt-1 text-right text-xs text-muted">You, {formatDayTime(m.created_at)}</p>
                </div>
              ) : (
                <>
                  <AgentMessage m={m} />
                  {m.kind === "recommendation" && <SuggestedSession m={m} state={state} />}
                  {m.awaiting_reply && <ReplyBox m={m} actionTitle={titleOf(m.related_action_id)} />}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
