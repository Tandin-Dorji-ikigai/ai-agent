"use client";

// Pema's top matches: why each mentor ranks where they do (the fixed-rule
// score, broken down), where the agent's request stands with each, and the
// proof that popularity does not decide the ranking.

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNu } from "@/lib/format";
import { WEIGHTS, type ScoreFactor } from "@/lib/matching/score-mentor";
import type { DemoState, MatchView, RequestRoundView } from "@/lib/state-types";

const FACTOR_LABEL: Record<ScoreFactor, string> = {
  expertise: "Expertise",
  sector: "Sector",
  business_stage: "Stage",
  language: "Language",
  availability: "Availability",
  budget: "Budget",
};

const STATUS: Record<string, [string, string]> = {
  pending: ["Asked, deciding now", "status-pending"],
  accepted: ["Accepted", "status-success"],
  declined: ["Declined", ""],
  expired: ["No reply", ""],
  cancelled: ["Request cancelled", ""],
  next: ["Next if needed", "status-primary"],
};

function Breakdown({ match }: { match: MatchView }) {
  return (
    <dl className="score-breakdown">
      {(Object.keys(WEIGHTS) as ScoreFactor[]).map((f) => (
        // dt and dd are direct children of each group, as a definition list requires.
        <div key={f} className="score-row">
          <dt className="muted">{FACTOR_LABEL[f]}</dt>
          <dd>
            <strong>
              {match.breakdown[f]}/{WEIGHTS[f]}
            </strong>
          </dd>
          <dd className="score-bar" aria-hidden>
            <span style={{ width: `${(match.breakdown[f] / WEIGHTS[f]) * 100}%` }} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function MatchList({ matches, round, mostBooked }: { matches: MatchView[]; round: RequestRoundView | null; mostBooked: DemoState["most_booked"] }) {
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
        <CardDescription>
          Ranked by fixed rules on expertise, sector, stage, language, availability and budget. The AI only explains the ranking. I ask them in this
          order, and each mentor decides.
        </CardDescription>
      </CardHeader>
      <CardContent className="stack">
        {matches.map((m) => {
          const s = statusFor(m.mentor.id);
          return (
            <div key={m.mentor.id} className="stack-tight match-row">
              <div className="row between wrap">
                <div>
                  <p className="kicker">#{m.rank} match</p>
                  <h3>{m.mentor.full_name}</h3>
                  <p className="subtitle">
                    {m.mentor.headline} · {formatNu(m.mentor.fee)} a session
                  </p>
                </div>
                <div className="row wrap">
                  {s && (
                    <Badge variant="secondary" className={s[1]}>
                      {s[0]}
                    </Badge>
                  )}
                  <strong className="match-score">
                    {m.score}
                    <span className="muted"> / 100</span>
                  </strong>
                </div>
              </div>
              <details>
                <summary className="text-sm font-semibold text-primary">See the score breakdown</summary>
                <Breakdown match={m} />
              </details>
            </div>
          );
        })}
        {mostBooked && mostBooked.rank !== null && mostBooked.rank > matches.length && (
          <p className="muted text-sm">
            {mostBooked.mentor.full_name} is the most-booked mentor on the platform ({mostBooked.mentor.sessions_delivered} sessions) but ranks {mostBooked.rank} of{" "}
            {mostBooked.eligible_count} for your needs ({mostBooked.score}/100). Popularity does not affect the ranking.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
