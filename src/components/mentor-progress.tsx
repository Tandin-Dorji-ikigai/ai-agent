"use client";

// The mentor's view of what happened between sessions: every check-in reply
// the agent recorded ("add to mentor progress"), and the agenda it builds for
// the next session (what needs the mentor most comes first).

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgendaItem, ProgressView } from "@/lib/state-types";

const PROGRESS_LABEL: Record<ProgressView["kind"], [string, string]> = {
  on_track: ["On track", "status-primary"],
  done: ["Done", "status-success"],
  obstacle: ["Obstacle", "status-pending"],
  help_requested: ["Needs help", "status-pending"],
  resource_recommended: ["Resource sent", ""],
  mentor_requested: ["Asked you for help", "status-primary"],
  mentor_session_suggested: ["Other mentor suggested", ""],
  escalated: ["Escalated to YDF", "status-pending"],
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

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Thimphu", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function MentorProgress({ progress, agenda, menteeFirstName }: { progress: ProgressView[]; agenda: AgendaItem[]; menteeFirstName: string }) {
  const items = [...progress].reverse();
  return (
    <div className="cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Agenda for your next session</CardTitle>
          <CardDescription>Built by the agent from {menteeFirstName}&apos;s check-ins.</CardDescription>
        </CardHeader>
        <CardContent className="stack-tight">
          {agenda.length === 0 ? (
            <p className="muted">Items appear here as the agent checks in with {menteeFirstName}.</p>
          ) : (
            agenda.map((a, i) => (
              <div key={`${a.kind}-${a.action_id}-${i}`} className="row">
                <Badge variant="secondary" className="shrink-0">
                  {AGENDA_LABEL[a.kind]}
                </Badge>
                <span className="text-sm">{a.text}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Progress since your session</CardTitle>
          <CardDescription>Every reply the agent recorded, newest first.</CardDescription>
        </CardHeader>
        <CardContent className="stack-tight">
          {items.length === 0 ? (
            <p className="muted">Nothing yet. The agent checks in before each due date and records every reply here.</p>
          ) : (
            items.map((p) => (
              <div key={p.id} className="stack-tight progress-item">
                <div className="row between wrap">
                  <Badge variant="secondary" className={PROGRESS_LABEL[p.kind][1]}>
                    {PROGRESS_LABEL[p.kind][0]}
                  </Badge>
                  <span className="muted text-xs">{when(p.created_at)}</span>
                </div>
                {p.action_title && <p className="text-sm font-semibold">{p.action_title}</p>}
                {p.note && <p className="muted text-sm">{p.note}</p>}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
