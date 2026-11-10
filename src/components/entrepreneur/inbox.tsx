"use client";

import { useState } from "react";
import { DEMO_BLOCKER_REPLY } from "@/lib/demo/fixtures";
import { formatDayTime } from "@/lib/format";
import type { DemoState, MessageView } from "@/lib/state-types";
import { useDemo } from "../demo-state";
import { Badge, Button, Card, SectionTitle, SourceBadge, inputClass } from "../ui";
import { newIdempotencyKey } from "./mentor-card";

// The agent inbox: how the agent reaches the entrepreneur between sessions.

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
        {m.kind === "recommendation" && <Badge tone="accent">Suggestion</Badge>}
        {escalationCode && <Badge tone="warning">Escalated: {escalationCode}</Badge>}
        {isFollowUp && !m.dz_verified && <Badge>Dzongkha version pending review</Badge>}
        <SourceBadge source={m.source} />
      </div>
    </div>
  );
}

function SuggestedSession({ m, credit }: { m: MessageView; credit: DemoState["credit"] }) {
  const { act, busy } = useDemo();
  const [key] = useState(newIdempotencyKey);
  const mentorId = typeof m.metadata.mentor_id === "string" ? m.metadata.mentor_id : null;
  if (!mentorId) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Button
        variant="secondary"
        busy={busy === "booking"}
        disabled={!credit || credit.amount_remaining <= 0}
        onClick={() => act("booking", "/api/booking", { mentor_id: mentorId, funding_type: "ydf_credit", idempotency_key: key })}
      >
        Book with YDF credit
      </Button>
      <Button
        variant="ghost"
        busy={busy === "booking"}
        onClick={() => act("booking", "/api/booking", { mentor_id: mentorId, funding_type: "self_paid", idempotency_key: `${key}-self` })}
      >
        Pay myself
      </Button>
    </div>
  );
}

export function Inbox({ state }: { state: DemoState }) {
  const { act, busy } = useDemo();
  const awaiting = [...state.messages].reverse().find((m) => m.awaiting_reply);
  const [reply, setReply] = useState(DEMO_BLOCKER_REPLY);

  return (
    <Card>
      <SectionTitle aside={awaiting ? <Badge tone="danger">Needs your reply</Badge> : undefined}>Messages from your mentoring agent</SectionTitle>
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
                  {m.kind === "recommendation" && <SuggestedSession m={m} credit={state.credit} />}
                </>
              )}
            </li>
          ))}
        </ol>
      )}

      {awaiting && (
        <form
          className="mt-4 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act("reply", "/api/inbox/reply", { message_id: awaiting.id, body: reply });
          }}
        >
          <label htmlFor="reply" className="block text-sm font-medium">
            Your reply
          </label>
          <textarea id="reply" rows={4} className={inputClass} value={reply} onChange={(e) => setReply(e.target.value)} required />
          <Button type="submit" className="w-full" busy={busy === "reply"}>
            {busy === "reply" ? "The agent is deciding..." : "Send reply"}
          </Button>
        </form>
      )}
    </Card>
  );
}
