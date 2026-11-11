"use client";

// The mentee's top matches: score, fee, and where the agent's request stands
// with each mentor (the agent asks them in this order; each mentor decides).

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNu } from "@/lib/format";
import type { MatchView, RequestRoundView } from "@/lib/state-types";

const STATUS: Record<string, [string, string]> = {
  pending: ["Asked, deciding", "status-pending"],
  accepted: ["Accepted", "status-success"],
  declined: ["Declined", ""],
  expired: ["No reply", ""],
  cancelled: ["Cancelled", ""],
  next: ["Next if needed", "status-primary"],
};

export function MatchList({ matches, round }: { matches: MatchView[]; round: RequestRoundView | null }) {
  if (matches.length === 0) return null;
  const statusFor = (mentorId: string) => {
    const r = round?.requests.find((x) => x.mentor.id === mentorId);
    if (r) return STATUS[r.status];
    return round?.next_mentor?.mentor.id === mentorId ? STATUS.next : null;
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your top matches</CardTitle>
      </CardHeader>
      <CardContent className="stack-tight">
        {matches.map((m) => {
          const s = statusFor(m.mentor.id);
          return (
            <div key={m.mentor.id} className="row between wrap match-row">
              <div>
                <h3>{m.mentor.full_name}</h3>
                <p className="subtitle">
                  {m.score}/100 match · {formatNu(m.mentor.fee)} a session
                </p>
              </div>
              {s && (
                <Badge variant="secondary" className={s[1]}>
                  {s[0]}
                </Badge>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
