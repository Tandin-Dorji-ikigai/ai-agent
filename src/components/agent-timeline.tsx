"use client";

import { useState } from "react";
import { BellRing, CalendarCheck, ClipboardCheck, Scale, Send, Sparkles, Target, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { sessionWhen } from "@/lib/agent-timeline";
import type { TimelineItem, TimelineKind } from "@/lib/state-types";

// Agent activity timeline: every step the agent took for the mentee, oldest
// first, then the next step it will take (greyed). Built from saved records.

const ICON: Record<TimelineKind, LucideIcon> = {
  assessed: ClipboardCheck,
  support: Target,
  compared: Scale,
  selected: Sparkles,
  requested: Send,
  scheduled: CalendarCheck,
  reminded: BellRing,
};

/** Long histories show the latest steps first; the rest open on request. */
const SHOW_DONE = 6;

export function AgentTimeline({ items }: { items: TimelineItem[] }) {
  const [all, setAll] = useState(false);
  const done = items.filter((i) => i.status === "done");
  const coming = items.filter((i) => i.status !== "done");
  const hidden = all ? 0 : Math.max(0, done.length - SHOW_DONE);
  const shown = [...done.slice(hidden), ...coming.slice(0, 2)];
  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>What the agent has done</CardTitle>
        <CardDescription>
          {done.length === 0 ? "Every step the agent takes for you appears here." : `${done.length} step${done.length === 1 ? "" : "s"} so far, oldest first.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="stack-tight">
        {hidden > 0 && (
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setAll(true)}>
            Show {hidden} earlier step{hidden === 1 ? "" : "s"}
          </Button>
        )}
        <ol className="agent-timeline" aria-label="Agent activity">
          {shown.map((item) => {
            const Icon = ICON[item.kind];
            return (
              <li key={item.key} className={`agent-timeline-item ${item.status}`}>
                <span className="agent-timeline-icon" aria-hidden="true">
                  <Icon className="size-4" strokeWidth={1.8} />
                </span>
                <div className="agent-timeline-body">
                  <div className="agent-timeline-head">
                    <p className="agent-timeline-title">{item.title}</p>
                    {item.status === "next" && (
                      <Badge variant="secondary" className="status-primary">
                        Next
                      </Badge>
                    )}
                  </div>
                  {item.detail && <p className="agent-timeline-detail">{item.detail}</p>}
                  {item.at && (
                    <time className="agent-timeline-time" dateTime={item.at}>
                      {sessionWhen(item.at)}
                    </time>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
