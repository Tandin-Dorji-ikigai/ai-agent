"use client";

// The voice intro for the needs assessment (Ascent design).
// Speak (or upload, or try a sample): the agent drafts the answers, shows
// "Here is what I understood" (heard / suggested / assumed / missing), asks
// only what it still needs, then finds the mentor by itself after a short
// countdown that the person can stop. Nothing is saved until then.

import { useEffect, useRef, useState } from "react";
import { Check, Mic } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useDemo } from "@/components/demo-state";
import type { AssessmentDraft, DraftField } from "@/lib/agent/schemas";
import { DEMO_ASPIRING_INTRO, DEMO_VOICE_INTRO } from "@/lib/demo/fixtures";
import { formatNu } from "@/lib/format";
import { LANGUAGE_LABEL, MENTORING_FORMAT_LABEL, SECTORS, STAGES, expertiseLabel, sectorLabel, stageLabel, type Expertise, type Language, type Stage } from "@/lib/types";
import {
  draftToAnswers,
  isComplete,
  mergeAnswers,
  statusesFor,
  stillNeeded,
  toAssessmentInput,
  withDefaults,
  type AnswerStatus,
  type DraftAnswers,
} from "@/lib/voice-draft";
import { VoiceRecorder } from "./voice-recorder";

const AUTO_SECONDS = 5;

const NEED_OPTIONS: Expertise[] = [
  "idea_development",
  "customer_validation",
  "market_positioning",
  "pricing",
  "community_tourism",
  "accounting",
  "digital_payments",
  "operations",
  "branding",
  "regulatory_compliance",
];

const STATUS_LABEL: Record<AnswerStatus, string> = { heard: "Heard", suggested: "Suggested", assumed: "Assumed", missing: "Not mentioned" };
const STATUS_CLASS: Record<AnswerStatus, string> = {
  heard: "status-success",
  suggested: "status-primary",
  assumed: "status-pending",
  missing: "status-pending",
};

type Statuses = Partial<Record<DraftField, AnswerStatus>>;

/** The quick questions, in the order they are shown. */
const QUESTION_FIELDS: DraftField[] = ["business_stage", "sector", "expertise_needs", "primary_challenge", "business_description"];
type TypedField = "primary_challenge" | "business_description";

const NEEDED_LABEL: Record<DraftField, string> = {
  business_name: "your business name",
  business_stage: "where you are now",
  sector: "the area",
  expertise_needs: "what you want help with",
  primary_challenge: "your biggest challenge",
  business_description: "what you do or want to do",
  languages: "your languages",
  preferred_language: "your preferred language",
  budget: "your budget",
};

interface DraftResponse {
  draft: AssessmentDraft;
  missing: DraftField[];
  suggested: DraftField[];
  source: "live_ai" | "fallback";
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" size="sm" variant={on ? "default" : "outline"} aria-pressed={on} onClick={onClick}>
      {children}
    </Button>
  );
}

export function VoiceIntro({
  live,
  onAnswers,
  onSave,
}: {
  /** Recording needs live AI (Whisper); the sample intros work without it. */
  live: boolean;
  /** Every change, so the full form below shows the same answers. */
  onAnswers: (answers: DraftAnswers) => void;
  /** Save and find the mentor; resolves false if it did not work. */
  onSave: (input: ReturnType<typeof toAssessmentInput>) => Promise<boolean>;
}) {
  const { act, busy } = useDemo();
  const [answers, setAnswers] = useState<DraftAnswers | null>(null);
  const [status, setStatus] = useState<Statuses>({});
  const [asked, setAsked] = useState<DraftField[]>([]);
  const [source, setSource] = useState<"live_ai" | "fallback" | null>(null);
  const [auto, setAuto] = useState<{ phase: "idle" | "counting" | "cancelled" | "saving"; left: number; run: number }>({ phase: "idle", left: AUTO_SECONDS, run: 0 });
  // Text typed in a quick-question box; it counts once the box loses focus or "Find my mentor" is pressed.
  const [typed, setTyped] = useState<Partial<Record<TypedField, string>>>({});
  const [triedFind, setTriedFind] = useState(false);
  const answersRef = useRef<DraftAnswers | null>(null);
  const remaining = useRef(AUTO_SECONDS);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  function update(next: DraftAnswers, nextStatus: Statuses) {
    setAnswers(next);
    setStatus(nextStatus);
    onAnswers(next);
    if (isComplete(next)) setAuto((a) => (a.phase === "idle" || a.phase === "counting" ? { phase: "counting", left: AUTO_SECONDS, run: a.run + 1 } : a));
  }

  async function save(from?: DraftAnswers) {
    const current = from ?? answersRef.current;
    if (!current || !isComplete(current)) return;
    setAuto((a) => ({ ...a, phase: "saving" }));
    const ok = await onSave(toAssessmentInput(current));
    if (!ok) setAuto((a) => ({ ...a, phase: "cancelled" }));
  }

  // One tick a second; at zero the agent goes ahead. A new run (changed answers) restarts it.
  useEffect(() => {
    if (auto.phase !== "counting") return;
    remaining.current = AUTO_SECONDS;
    const id = setInterval(() => {
      remaining.current -= 1;
      setAuto((a) => (a.phase === "counting" ? { ...a, left: Math.max(0, remaining.current) } : a));
      if (remaining.current <= 0) {
        clearInterval(id);
        void save();
      }
    }, 1000);
    return () => clearInterval(id);
    // save() reads the latest answers through answersRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.phase, auto.run]);

  /** The answers with anything typed in the quick-question boxes that has not counted yet. */
  function withTyped(a: DraftAnswers): { next: DraftAnswers; nextStatus: Statuses } {
    const next = { ...a };
    const nextStatus = { ...status };
    for (const f of ["primary_challenge", "business_description"] as const) {
      const v = typed[f]?.trim();
      if (v && v !== a[f]) {
        next[f] = v;
        nextStatus[f] = "heard";
      }
    }
    return { next, nextStatus };
  }

  /** "Find my mentor": goes ahead at once, or says exactly which answers are still needed. */
  function findNow() {
    if (!answers) return;
    setTriedFind(true);
    const { next, nextStatus } = withTyped(answers);
    if (!isComplete(next)) return;
    setAnswers(next);
    setStatus(nextStatus);
    onAnswers(next);
    answersRef.current = next;
    void save(next);
  }

  /** A typed answer counts when the box loses focus. */
  function commitTyped(field: TypedField) {
    const v = typed[field]?.trim();
    setTyped((t) => ({ ...t, [field]: undefined }));
    if (v && answers && v !== answers[field]) set(field, v);
  }

  /** The first intro replaces the answers; answering by voice again only fills what is still missing. */
  async function draftFrom(transcript: string) {
    const res = await act("voice-draft", "/api/assessment/draft", { transcript });
    if (!res.ok) return;
    const { draft, missing, suggested, source: from } = res as unknown as DraftResponse;
    const incoming = draftToAnswers(draft);
    setSource(from);
    if (!answers) {
      const { answers: filled, assumed } = withDefaults(incoming, transcript);
      setAsked(missing.filter((f) => !assumed.includes(f)));
      update(filled, statusesFor(filled, missing.filter((f) => !assumed.includes(f)), suggested, assumed));
      return;
    }
    const merged = mergeAnswers(answers, status, incoming, statusesFor(incoming, missing, suggested, []));
    update(merged.answers, merged.status);
  }

  /** A quick answer counts as the person's own ("Heard"). */
  function set<K extends keyof DraftAnswers>(key: K, value: DraftAnswers[K]) {
    if (!answers) return;
    const next = { ...answers, [key]: value };
    if (key === "preferred_language" && value && !next.languages.includes(value as Language)) next.languages = [...next.languages, value as Language];
    update(next, { ...status, [key]: "heard" });
  }

  if (!answers) {
    return (
      <Card className="form-card">
        <CardHeader>
          <CardTitle className="row">
            <Mic className="size-4 text-primary" />
            Prefer to talk? Introduce yourself
          </CardTitle>
          <CardDescription>
            Say who you are, what you do or want to do, what you need help with, and your budget if you know it. I will fill in the answers for you to check.
          </CardDescription>
        </CardHeader>
        <CardContent className="stack">
          <VoiceRecorder
            available={live}
            onText={(text) => void draftFrom(text)}
            title="Record your intro (English)"
            recordLabel="Record my intro"
            hint="Up to 3 minutes. The audio is turned into text by Whisper and not kept."
            language="en"
            maxSeconds={180}
            unavailableText="Recording needs live AI. You can still try a sample intro below."
          />
          <div className="row wrap">
            <Button type="button" variant="outline" disabled={busy === "voice-draft"} onClick={() => void draftFrom(DEMO_VOICE_INTRO)}>
              {busy === "voice-draft" ? "Reading…" : "Use a sample intro"}
            </Button>
            <Button type="button" variant="ghost" disabled={busy === "voice-draft"} onClick={() => void draftFrom(DEMO_ASPIRING_INTRO)}>
              Try a sample without a business
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const rows: Array<[DraftField, string, string]> = [
    ["business_name", "Business", answers.business_name || "No business yet"],
    ["sector", "Area", answers.sector ? sectorLabel(answers.sector) : ""],
    ["business_stage", "Stage", answers.business_stage ? stageLabel(answers.business_stage) : ""],
    ["business_description", "What you do or want to do", answers.business_description],
    ["primary_challenge", "Main challenge", answers.primary_challenge],
    ["expertise_needs", "Help with", answers.expertise_needs.map(expertiseLabel).join(", ")],
    ["preferred_language", "Preferred language", answers.preferred_language ? LANGUAGE_LABEL[answers.preferred_language] : ""],
    ["budget", "Budget per session", answers.budget === "" ? "" : Number(answers.budget) === 0 ? "Not sure yet" : formatNu(Number(answers.budget))],
  ];
  // Optional extras: shown only when the person said them (never asked about).
  const extras: Array<[string, string]> = (
    [
      ["Done so far", answers.progress_so_far],
      ["How it should work", answers.vision],
      ["Hoping to get there in", answers.timeframe],
      ["Wants to meet", answers.mentoring_format ? MENTORING_FORMAT_LABEL[answers.mentoring_format] : ""],
    ] as Array<[string, string]>
  ).filter(([, value]) => value);
  const needed = stillNeeded(withTyped(answers).next);
  // A question stays once asked (so a choice can be changed), and anything still needed is always asked.
  const questions = QUESTION_FIELDS.filter((f) => asked.includes(f) || needed.includes(f));
  const toAnswer = questions.filter((f) => needed.includes(f)).length;
  const complete = isComplete(answers);

  return (
    <Card className="form-card">
      <CardHeader>
        <div className="row between wrap">
          <CardTitle>Here is what I understood</CardTitle>
          {source && <Badge variant="outline">{source === "live_ai" ? "Live AI" : "Read without AI"}</Badge>}
        </div>
        <CardDescription>Check it. Anything marked &quot;Suggested&quot; or &quot;Assumed&quot; was not said outright; change it below if it is wrong.</CardDescription>
        {source === "fallback" && <p className="muted">The AI is busy right now, so I read your intro with simple rules and may have missed some answers.</p>}
      </CardHeader>
      <CardContent className="stack">
        <div className="stack-tight" role="list" aria-label="Your answers">
          {rows.map(([field, label, value]) => {
            const s = status[field] ?? (value ? "heard" : "missing");
            return (
              <div role="listitem" className="info-pair" key={field}>
                <span>{label}</span>
                <span className="row wrap">
                  <strong>{value || "Not given"}</strong>
                  <Badge variant="secondary" className={STATUS_CLASS[s]}>
                    {STATUS_LABEL[s]}
                  </Badge>
                </span>
              </div>
            );
          })}
          {extras.map(([label, value]) => (
            <div role="listitem" className="info-pair" key={label}>
              <span>{label}</span>
              <span className="row wrap">
                <strong>{value}</strong>
                <Badge variant="secondary" className={STATUS_CLASS.heard}>
                  {STATUS_LABEL.heard}
                </Badge>
              </span>
            </div>
          ))}
        </div>

        {questions.length > 0 && (
          <div className="stack">
            <h3>{toAnswer === 0 ? "Your quick answers" : toAnswer === 1 ? "One quick question, then I find your mentor" : `${toAnswer} quick questions, then I find your mentor`}</h3>
            {questions.includes("business_stage") && (
              <fieldset className="stack-tight">
                <legend className="text-sm font-semibold">Where are you now?</legend>
                <div className="row wrap">
                  {STAGES.map((st: Stage) => (
                    <Chip key={st} on={answers.business_stage === st} onClick={() => set("business_stage", st)}>
                      {stageLabel(st)}
                    </Chip>
                  ))}
                </div>
              </fieldset>
            )}
            {questions.includes("sector") && (
              <fieldset className="stack-tight">
                <legend className="text-sm font-semibold">Which area?</legend>
                <div className="row wrap">
                  {SECTORS.map((sec) => (
                    <Chip key={sec} on={answers.sector === sec} onClick={() => set("sector", sec)}>
                      {sectorLabel(sec)}
                    </Chip>
                  ))}
                </div>
              </fieldset>
            )}
            {questions.includes("expertise_needs") && (
              <fieldset className="stack-tight">
                <legend className="text-sm font-semibold">What do you want help with? (up to 5)</legend>
                <div className="row wrap">
                  {NEED_OPTIONS.map((need) => {
                    const on = answers.expertise_needs.includes(need);
                    return (
                      <Chip
                        key={need}
                        on={on}
                        onClick={() =>
                          set("expertise_needs", on ? answers.expertise_needs.filter((n) => n !== need) : [...answers.expertise_needs, need].slice(0, 5))
                        }
                      >
                        {expertiseLabel(need)}
                      </Chip>
                    );
                  })}
                </div>
              </fieldset>
            )}
            {questions.includes("primary_challenge") && (
              <div className="field">
                <label htmlFor="voice-challenge" className="text-sm font-semibold">
                  What is your biggest challenge right now?
                </label>
                <Textarea
                  id="voice-challenge"
                  rows={2}
                  maxLength={1000}
                  value={typed.primary_challenge ?? answers.primary_challenge}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setTyped((t) => ({ ...t, primary_challenge: e.target.value }))}
                  onBlur={() => commitTyped("primary_challenge")}
                />
              </div>
            )}
            {questions.includes("business_description") && (
              <div className="field">
                <label htmlFor="voice-description" className="text-sm font-semibold">
                  In a sentence, what do you do or want to do?
                </label>
                <Textarea
                  id="voice-description"
                  rows={2}
                  maxLength={1000}
                  value={typed.business_description ?? answers.business_description}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setTyped((t) => ({ ...t, business_description: e.target.value }))}
                  onBlur={() => commitTyped("business_description")}
                />
              </div>
            )}
          </div>
        )}

        {complete && auto.phase === "counting" && (
          <Alert>
            <Check className="size-4" />
            <AlertTitle aria-live="polite">Finding your mentor in {auto.left} s</AlertTitle>
            <AlertDescription>
              <div className="row wrap">
                <Button type="button" size="sm" onClick={() => void save()}>
                  Find them now
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setAuto((a) => ({ ...a, phase: "cancelled" }))}>
                  Wait, let me check first
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
        {auto.phase === "saving" && <p role="status">Saving your answers and finding your mentor…</p>}
        {!(complete && auto.phase === "counting") && auto.phase !== "saving" && (
          <div className="stack-tight">
            <Button type="button" className="self-start" disabled={Boolean(busy)} onClick={findNow}>
              Find my mentor
            </Button>
            {triedFind && needed.length > 0 && (
              <p role="alert" className="text-sm text-destructive">
                Before I can find your mentor, answer: {needed.map((f) => NEEDED_LABEL[f]).join(", ")}.
              </p>
            )}
          </div>
        )}

        <VoiceRecorder
          available={live}
          onText={(text) => void draftFrom(text)}
          title="Or answer by voice"
          recordLabel="Record an answer"
          hint="Fills only what is still missing or assumed."
          language="en"
          maxSeconds={120}
          unavailableText="Answering by voice needs live AI. Use the quick questions or the full form below."
        />
      </CardContent>
    </Card>
  );
}
