"use client";

import { useState } from "react";
import { formatNu } from "@/lib/format";
import { WEIGHTS, type ScoreFactor } from "@/lib/matching/score-mentor";
import type { DemoState, MatchView } from "@/lib/state-types";
import { LANGUAGE_LABEL } from "@/lib/types";
import { useDemo } from "../demo-state";
import { Badge, Button, SourceBadge } from "../ui";

const FACTOR_LABEL: Record<ScoreFactor, string> = {
  expertise: "Expertise",
  sector: "Sector",
  business_stage: "Stage",
  language: "Language",
  availability: "Availability",
  budget: "Budget",
};

/** Works on plain http over a LAN too, where crypto.randomUUID is unavailable. */
export function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function ScoreBreakdown({ breakdown }: { breakdown: MatchView["breakdown"] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
      {(Object.keys(WEIGHTS) as ScoreFactor[]).map((f) => {
        const value = breakdown[f];
        const max = WEIGHTS[f];
        return (
          <div key={f}>
            <div className="flex justify-between text-muted">
              <dt>{FACTOR_LABEL[f]}</dt>
              <dd className={value === 0 ? "text-muted" : "font-semibold text-ink"}>
                {value}/{max}
              </dd>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
              <div className="h-full rounded-full bg-accent" style={{ width: `${(value / max) * 100}%` }} />
            </div>
          </div>
        );
      })}
    </dl>
  );
}

export function MentorCard({ match, credit }: { match: MatchView; credit: DemoState["credit"] }) {
  const { act, busy } = useDemo();
  const m = match.mentor;
  const creditCovers = !!credit && credit.status === "active" && credit.amount_remaining >= m.fee;
  const [open, setOpen] = useState(false);
  const [funding, setFunding] = useState<"ydf_credit" | "self_paid">(creditCovers ? "ydf_credit" : "self_paid");
  const [key, setKey] = useState(newIdempotencyKey);

  const book = async () => {
    const res = await act("booking", "/api/booking", { mentor_id: m.id, funding_type: funding, idempotency_key: key });
    if (!res.ok) setKey(newIdempotencyKey());
  };

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

      {!open ? (
        <Button className="mt-4 w-full" variant="secondary" onClick={() => setOpen(true)} disabled={m.slots_remaining < 1}>
          Choose {m.full_name.split(" ")[0]}
        </Button>
      ) : (
        <fieldset className="mt-4 space-y-2">
          <legend className="mb-1 text-sm font-semibold">How will this session be paid?</legend>
          <label className="flex min-h-11 items-start gap-2 rounded-lg border border-line p-3 text-sm">
            <input
              type="radio"
              name={`funding-${m.id}`}
              className="mt-0.5 size-4 accent-accent"
              checked={funding === "ydf_credit"}
              disabled={!creditCovers}
              onChange={() => setFunding("ydf_credit")}
            />
            <span>
              <span className="font-medium">Use my YDF credit</span>
              <span className="block text-muted">
                {credit ? `${formatNu(credit.amount_remaining)} of ${formatNu(credit.amount_granted)} left` : "No credit available"}
                {credit && !creditCovers ? " (not enough for this fee)" : ""}
              </span>
            </span>
          </label>
          <label className="flex min-h-11 items-start gap-2 rounded-lg border border-line p-3 text-sm">
            <input
              type="radio"
              name={`funding-${m.id}`}
              className="mt-0.5 size-4 accent-accent"
              checked={funding === "self_paid"}
              onChange={() => setFunding("self_paid")}
            />
            <span>
              <span className="font-medium">Pay myself</span>
              <span className="block text-muted">Simulated payment of {formatNu(m.fee)}. No money moves in this prototype.</span>
            </span>
          </label>
          <div className="flex gap-2 pt-1">
            <Button className="flex-1" busy={busy === "booking"} onClick={book}>
              Book session
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </fieldset>
      )}
    </article>
  );
}
