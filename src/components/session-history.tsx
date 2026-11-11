"use client";

import { useState } from "react";
import { MessageSquareText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDemo } from "@/components/demo-state";
import { relativeDue } from "@/lib/format";
import type { SessionHistoryItem } from "@/lib/state-types";
import type { TranscriptTurn } from "@/lib/transcript-turns";
import type { ActionItemRecord } from "@/lib/types";

// Every completed session, for the mentee and the mentor: what was discussed
// and achieved (the agent's recap of the transcript or notes), the agreed next
// steps with their progress, and the whole conversation.

const STATUS_LABEL: Record<string, string> = { pending: "To do", completed: "Done", blocked: "Blocked", overdue: "Overdue" };
const STATUS_CLASS: Record<string, string> = { completed: "status-success", pending: "status-primary", overdue: "status-pending", blocked: "status-pending" };

function sessionDay(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Thimphu" }).format(new Date(iso));
}

export function SessionHistory({
  sessions,
  actions,
  role,
  menteeName,
  now,
}: {
  sessions: SessionHistoryItem[];
  actions: ActionItemRecord[];
  role: "entrepreneur" | "mentor";
  menteeName: string;
  now: string;
}) {
  if (sessions.length === 0) return null;
  return (
    <section className="stack" aria-labelledby="session-history-title">
      <div>
        <h2 id="session-history-title">{role === "mentor" ? `Sessions with ${menteeName}` : "Your sessions"}</h2>
        <p className="subtitle">What each session covered and achieved, written by the agent from the conversation, with the agreed next steps.</p>
      </div>
      {sessions.map((s, i) => (
        <SessionCard
          key={s.id}
          session={s}
          number={sessions.length - i}
          actions={actions.filter((a) => a.session_id === s.id)}
          role={role}
          withName={role === "mentor" ? menteeName : s.mentor_name}
          now={now}
        />
      ))}
    </section>
  );
}

function SessionCard({
  session: s,
  number,
  actions,
  role,
  withName,
  now,
}: {
  session: SessionHistoryItem;
  number: number;
  actions: ActionItemRecord[];
  role: "entrepreneur" | "mentor";
  withName: string;
  now: string;
}) {
  const { act, busy } = useDemo();
  const agreed = actions.filter((a) => a.status !== "draft");
  const drafts = actions.length - agreed.length;
  const done = agreed.filter((a) => a.status === "completed").length;
  return (
    <Card>
      <CardHeader>
        <div className="row between wrap">
          <CardTitle>
            Session {number} · {sessionDay(s.scheduled_at)}
          </CardTitle>
          <Badge variant="secondary" className="status-success">
            Completed
          </Badge>
        </div>
        <CardDescription>
          With {withName}
          {s.agent_summary ? `. ${s.agent_summary}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="stack">
        {s.recap ? (
          <div className="session-recap">
            <div>
              <h3>What was discussed</h3>
              <ul className="session-points">{s.recap.discussed.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
            <div>
              <h3>What was achieved</h3>
              {s.recap.achieved.length > 0 ? (
                <ul className="session-points">{s.recap.achieved.map((p) => <li key={p}>{p}</li>)}</ul>
              ) : (
                <p className="muted">Nothing clearly achieved was noted in this session.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="stack-tight">
            <p className="muted">No recap of this session yet.</p>
            <Button variant="outline" size="sm" className="self-start" disabled={Boolean(busy)} onClick={() => void act(`recap-${s.id}`, "/api/session/recap", { session_id: s.id })}>
              {busy === `recap-${s.id}` ? "Writing the recap…" : "Write the recap"}
            </Button>
          </div>
        )}

        <div>
          <div className="row between wrap">
            <h3>Agreed next steps</h3>
            {agreed.length > 0 && <span className="muted text-xs">{done} of {agreed.length} done</span>}
          </div>
          {agreed.length > 0 ? (
            <ul className="session-actions">
              {agreed.map((a) => (
                <li key={a.id} className="row between wrap">
                  <span className="grow">
                    {a.title}
                    {a.status !== "completed" && a.due_at && <span className="muted text-xs"> · {relativeDue(a.due_at, now)}</span>}
                  </span>
                  <Badge variant="secondary" className={STATUS_CLASS[a.status] ?? ""}>
                    {STATUS_LABEL[a.status] ?? a.status}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{drafts > 0 ? "Waiting for the mentor to confirm the next steps." : "No next steps were agreed in this session."}</p>
          )}
        </div>

        {role === "mentor" && s.notes_source !== "call_recording" && s.mentor_notes && (
          <div>
            <h3>Your notes</h3>
            <p className="muted whitespace-pre-wrap">{s.mentor_notes}</p>
          </div>
        )}

        {s.transcript_chars > 0 && <SessionTranscript sessionId={s.id} role={role} withName={withName} />}
      </CardContent>
    </Card>
  );
}

function SessionTranscript({ sessionId, role, withName }: { sessionId: string; role: "entrepreneur" | "mentor"; withName: string }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<TranscriptTurn[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    if (turns) return;
    setError(null);
    try {
      const res = await fetch(`/api/session/transcript?session_id=${sessionId}`, { cache: "no-store" });
      const json = (await res.json()) as { ok: boolean; turns?: TranscriptTurn[]; message?: string };
      if (json.ok && json.turns) setTurns(json.turns);
      else setError(json.message ?? "The conversation could not be loaded.");
    } catch {
      setError("The conversation could not be loaded.");
    }
  }

  const name = (speaker: TranscriptTurn["speaker"]) => (speaker === null ? "" : speaker === role ? "You" : withName.split(" ")[0]);
  return (
    <div className="stack-tight">
      <Button variant="ghost" size="sm" className="self-start" aria-expanded={open} onClick={() => void toggle()}>
        <MessageSquareText className="size-4" />
        {open ? "Hide the conversation" : "Show the whole conversation"}
      </Button>
      {open && (
        <div className="session-transcript" aria-label="Conversation transcript">
          {error && <p className="muted">{error}</p>}
          {!error && !turns && <p className="muted">Loading the conversation…</p>}
          {turns?.length === 0 && <p className="muted">This session has no transcript.</p>}
          {turns?.map((t, i) => (
            <div key={i} className={`transcript-turn ${t.speaker === role ? "mine" : "theirs"}`}>
              {t.speaker && <span className="transcript-speaker">{name(t.speaker)}</span>}
              <p className="whitespace-pre-wrap">{t.text}</p>
            </div>
          ))}
          <p className="muted text-xs">Written from the call recording, so it may contain transcription mistakes.</p>
        </div>
      )}
    </div>
  );
}
