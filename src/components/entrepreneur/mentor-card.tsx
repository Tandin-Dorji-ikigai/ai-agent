"use client";

import { formatNu } from "@/lib/format";
import { WEIGHTS, type ScoreFactor } from "@/lib/matching/score-mentor";
import type { MatchView } from "@/lib/state-types";
import { LANGUAGE_LABEL } from "@/lib/types";
import { Badge, SourceBadge } from "../ui";

const FACTOR_LABEL: Record<ScoreFactor, string> = {
  expertise: "Expertise",
  sector: "Sector",
  business_stage: "Stage",
  language: "Language",
  availability: "Availability",
  budget: "Budget",
};

export function ScoreBreakdown({ breakdown }: { breakdown: MatchView["breakdown"] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
      {(Object.keys(WEIGHTS) as ScoreFactor[]).map((f) => {
        const value = breakdown[f];
        const max = WEIGHTS[f];
        return (
          // dt and dd are direct children of the group, as a definition list requires.
          <div key={f} className="grid grid-cols-[1fr_auto]">
            <dt className="text-muted">{FACTOR_LABEL[f]}</dt>
            <dd className={value === 0 ? "text-muted" : "font-semibold text-ink"}>
              {value}/{max}
            </dd>
            <dd className="col-span-2 mt-0.5 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
              <div className="h-full rounded-full bg-accent" style={{ width: `${(value / max) * 100}%` }} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Where this mentor is in the agent's request round. */
export type RequestChip = "pending" | "accepted" | "declined" | "expired" | "cancelled" | "next";

const CHIP: Record<RequestChip, [string, "info" | "success" | "neutral" | "accent"]> = {
  pending: ["Asked, deciding now", "info"],
  accepted: ["Accepted", "success"],
  declined: ["Declined", "neutral"],
  expired: ["No reply", "neutral"],
  cancelled: ["Request cancelled", "neutral"],
  next: ["Next if needed", "accent"],
};

export function MentorCard({ match, chip }: { match: MatchView; chip?: RequestChip }) {
  const m = match.mentor;
  return (
    <article className="rounded-xl border border-line bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted">#{match.rank} recommended</p>
          <h3 className="text-base font-semibold">{m.full_name}</h3>
          <p className="text-sm text-muted">
            {m.headline}
            {m.location ? `, ${m.location}` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold leading-none text-accent-strong">{match.score}</p>
          <p className="text-xs text-muted">of 100</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {chip && <Badge tone={CHIP[chip][1]}>{CHIP[chip][0]}</Badge>}
        <Badge>{formatNu(m.fee)} per session</Badge>
        <Badge>{m.languages.map((l) => LANGUAGE_LABEL[l]).join(", ")}</Badge>
        <Badge tone={m.slots_remaining > 0 ? "success" : "danger"}>
          {m.slots_remaining > 0 ? `${m.slots_remaining} open` : "Fully booked"}
        </Badge>
        <Badge tone="success">Verified</Badge>
      </div>

      {match.explanation && (
        <div className="mt-3 rounded-lg bg-sunken p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-muted">Why this mentor</p>
            <SourceBadge source={match.explanation_source} />
          </div>
          <p className="text-sm">{match.explanation}</p>
        </div>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium text-accent">See the score breakdown</summary>
        <div className="mt-2">
          <ScoreBreakdown breakdown={match.breakdown} />
        </div>
      </details>
    </article>
  );
}
