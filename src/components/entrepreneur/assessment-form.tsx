"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { DraftField } from "@/lib/agent/assessment-rules";
import type { AssessmentDraft } from "@/lib/agent/schemas";
import { DEMO_ASPIRING_INTRO, DEMO_VOICE_INTRO, PEMA_ASSESSMENT_ANSWERS } from "@/lib/demo/fixtures";
import { formatNu } from "@/lib/format";
import {
  EXPERTISE_LABEL,
  LANGUAGE_LABEL,
  LANGUAGES,
  SECTOR_LABEL,
  SECTORS,
  STAGE_LABEL,
  STAGES,
  type EntrepreneurRecord,
  type Expertise,
  type Language,
  type Stage,
} from "@/lib/types";
import { useDemo } from "../demo-state";
import { Badge, Button, Card, ChoiceChips, Label, Notice, SourceBadge, inputClass } from "../ui";
import { VoiceRecorder } from "../voice/voice-recorder";

// The needs assessment. Two ways in:
//  - typing (pre-filled with Pema's answers so the scripted demo is fast), or
//  - speaking (English for now): the agent drafts the answers, says what it
//    understood (heard or suggested), and asks only what it still needs.
// After a voice intro the agent proceeds by itself: small gaps get safe,
// labelled defaults ("Assumed"), and once it has enough it saves the answers
// and finds mentors after a short countdown that the person can stop.
// Nothing irreversible happens: the agent then asks a mentor, and a session
// is booked only when that mentor accepts.

/** Seconds the agent waits (showing what it understood) before finding mentors. */
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

const STAGE_QUESTION_LABEL: Record<Stage, string> = {
  idea: "Just an idea, or no idea yet",
  early: "Started, first customers",
  growth: "Growing",
  established: "Established",
};

/** 0 = "Not sure yet": matching treats it as neutral and YDF credit can cover fees. */
const BUDGET_CHOICES = [500, 1000, 1500, 2000, 3000, 0];

export interface FormState {
  business_name: string;
  business_stage: Stage | "";
  sector: string;
  business_description: string;
  primary_challenge: string;
  goals: string[];
  expertise_needs: Expertise[];
  languages: Language[];
  preferred_language: Language | "";
  budget: number | "";
}

type Status = "heard" | "suggested" | "assumed" | "missing";

interface VoiceState {
  transcript: string;
  status: Partial<Record<DraftField, Status>>;
  /** The follow-up questions, fixed when the draft arrives. */
  asked: DraftField[];
  source: "live_ai" | "fallback";
}

const initialForm = (): FormState => ({
  ...PEMA_ASSESSMENT_ANSWERS,
  goals: [...PEMA_ASSESSMENT_ANSWERS.goals],
  expertise_needs: [...PEMA_ASSESSMENT_ANSWERS.expertise_needs] as Expertise[],
  languages: [...PEMA_ASSESSMENT_ANSWERS.languages],
});

/** The saved profile as form answers (for "Change my answers"). */
export function profileToForm(e: EntrepreneurRecord): FormState {
  return {
    business_name: e.business_name ?? "",
    business_stage: e.business_stage ?? "",
    sector: e.sector ?? "",
    business_description: e.business_description ?? "",
    primary_challenge: e.primary_challenge ?? "",
    goals: e.goals ?? [],
    expertise_needs: (e.expertise_needs ?? []) as Expertise[],
    languages: e.languages ?? [],
    preferred_language: e.preferred_language ?? "",
    budget: e.budget ?? "",
  };
}

function isComplete(f: FormState): boolean {
  return (
    f.sector !== "" &&
    f.business_stage !== "" &&
    f.business_description.trim() !== "" &&
    f.primary_challenge.trim() !== "" &&
    f.expertise_needs.length > 0 &&
    f.expertise_needs.length <= 5 &&
    f.languages.length > 0 &&
    f.preferred_language !== "" &&
    f.languages.includes(f.preferred_language as Language) &&
    f.budget !== ""
  );
}

/** Safe defaults for small gaps, so the agent can go ahead; each is labelled "Assumed". */
function withDefaults(f: FormState): { form: FormState; assumed: DraftField[] } {
  const next = { ...f, languages: [...f.languages] };
  const assumed: DraftField[] = [];
  if (next.languages.length === 0) {
    next.languages = ["en"]; // the intro was spoken in English
    assumed.push("languages");
  }
  if (!next.preferred_language) {
    next.preferred_language = next.languages.length === 1 ? next.languages[0] : "en";
    if (!next.languages.includes(next.preferred_language)) next.languages.push(next.preferred_language);
    assumed.push("preferred_language");
  }
  if (next.budget === "") {
    next.budget = 0; // "not sure": neutral in matching, YDF credit can cover fees
    assumed.push("budget");
  }
  return { form: next, assumed };
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

function draftToForm(d: AssessmentDraft): FormState {
  return {
    business_name: d.business_name ?? "",
    sector: d.sector ?? "",
    business_stage: d.business_stage ?? "",
    business_description: d.business_description ?? "",
    primary_challenge: d.primary_challenge ?? "",
    goals: d.goals ?? [],
    expertise_needs: d.expertise_needs ?? [],
    languages: d.languages ?? [],
    preferred_language: d.preferred_language ?? "",
    budget: d.budget ?? "",
  };
}

function FieldHint({ field, voice }: { field: DraftField; voice: VoiceState | null }) {
  const status = voice?.status[field];
  if (!status) return null;
  if (status === "assumed") return <p className="mt-1 text-xs font-medium text-info">Assumed, change it if it is wrong</p>;
  if (status === "missing") {
    return field === "business_name" ? (
      <p className="mt-1 text-xs text-muted">Optional: leave empty if you have no business name yet</p>
    ) : (
      <p className="mt-1 text-xs font-medium text-warning">Not mentioned, please fill in</p>
    );
  }
  return <p className="mt-1 text-xs text-muted">{status === "heard" ? "From your voice intro" : "Suggested from what you said, please check"}</p>;
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={
        on
          ? "min-h-11 rounded-full border border-accent bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent-strong"
          : "min-h-11 rounded-full border border-line bg-card px-3 py-1.5 text-sm text-muted hover:text-ink"
      }
    >
      {children}
    </button>
  );
}

export function AssessmentForm({ initial, onDone, heading = "Tell us about your business" }: { initial?: FormState; onDone?: () => void; heading?: string } = {}) {
  const { act, busy, state } = useDemo();
  const [form, setForm] = useState<FormState>(() => initial ?? initialForm());
  const [voice, setVoice] = useState<VoiceState | null>(null);
  const live = state?.ai_mode === "live";

  // ----- the agent going ahead by itself -----
  const [auto, setAuto] = useState<{ phase: "idle" | "counting" | "cancelled" | "running"; secondsLeft: number; startId: number }>({
    phase: "idle",
    secondsLeft: AUTO_SECONDS,
    startId: 0,
  });
  const remaining = useRef(AUTO_SECONDS);
  const formRef = useRef(form);
  useEffect(() => {
    formRef.current = form;
  }, [form]);

  async function save(f: FormState): Promise<boolean> {
    const payload = { ...f, budget: Number(f.budget), goals: f.goals.map((g) => g.trim()).filter(Boolean) };
    const saved = await act("assessment", "/api/assessment", payload);
    if (!saved.ok) return false;
    const matched = await act("matching", "/api/matches");
    if (matched.ok) onDone?.();
    return matched.ok;
  }

  async function runAuto() {
    setAuto((a) => ({ ...a, phase: "running" }));
    const ok = await save(formRef.current);
    if (!ok) setAuto((a) => ({ ...a, phase: "cancelled" }));
  }

  // One tick a second; at zero the agent goes ahead. A restart (new startId) resets it.
  useEffect(() => {
    if (auto.phase !== "counting") return;
    remaining.current = AUTO_SECONDS;
    const id = setInterval(() => {
      remaining.current -= 1;
      setAuto((a) => (a.phase === "counting" ? { ...a, secondsLeft: Math.max(0, remaining.current) } : a));
      if (remaining.current <= 0) {
        clearInterval(id);
        void runAuto();
      }
    }, 1000);
    return () => clearInterval(id);
    // runAuto reads the latest answers through formRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.phase, auto.startId]);

  /** Start (or restart) the countdown when the answers are complete. */
  function maybeStart(next: FormState) {
    if (!isComplete(next)) return;
    setAuto((a) =>
      a.phase === "idle" || a.phase === "counting" ? { phase: "counting", secondsLeft: AUTO_SECONDS, startId: a.startId + 1 } : a,
    );
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    const next = { ...form, [key]: value };
    setForm(next);
    // An answered field is no longer "missing" (and now counts as the person's own answer).
    setVoice((v) => (v && key in v.status ? { ...v, status: { ...v.status, [key]: "heard" } } : v));
    if (voice) maybeStart(next);
  };

  const toggleNeed = (need: Expertise) =>
    set(
      "expertise_needs",
      form.expertise_needs.includes(need) ? form.expertise_needs.filter((n) => n !== need) : [...form.expertise_needs, need],
    );
  const toggleLanguage = (lang: Language) =>
    set("languages", form.languages.includes(lang) ? form.languages.filter((l) => l !== lang) : [...form.languages, lang]);
  const choosePreferred = (lang: Language) => {
    set("preferred_language", lang);
    if (!form.languages.includes(lang)) set("languages", [...form.languages, lang]);
  };

  /** First intro replaces the answers; "answer by voice" later only fills what is still missing. */
  async function draftFrom(transcript: string, merge: boolean) {
    const res = await act("voice-draft", "/api/assessment/draft", { transcript });
    if (!res.ok) return;
    const { draft, missing, suggested, source } = res as unknown as {
      draft: AssessmentDraft;
      missing: DraftField[];
      suggested: DraftField[];
      source: VoiceState["source"];
    };
    const incoming = draftToForm(draft);
    const statusOf = (f: DraftField): Status => (missing.includes(f) || isEmpty(incoming[f]) ? "missing" : suggested.includes(f) ? "suggested" : "heard");

    if (!merge || !voice) {
      const status: VoiceState["status"] = {};
      for (const f of Object.keys(incoming) as Array<keyof FormState>) if (f !== "goals") status[f as DraftField] = statusOf(f as DraftField);
      const { form: filled, assumed } = withDefaults(incoming);
      for (const f of assumed) status[f] = "assumed";
      setForm(filled);
      setVoice({ transcript, status, asked: missing.filter((f) => !assumed.includes(f)), source });
      maybeStart(filled);
      return;
    }
    // Merge: fill fields that are still empty, and replace the agent's assumptions.
    const next = { ...form };
    const status = { ...voice.status };
    for (const f of Object.keys(incoming) as Array<keyof FormState>) {
      if (f === "goals") continue;
      const replaceable = isEmpty(next[f]) || status[f as DraftField] === "assumed";
      if (replaceable && !isEmpty(incoming[f])) {
        (next as Record<string, unknown>)[f] = incoming[f];
        status[f as DraftField] = statusOf(f as DraftField);
      }
    }
    if (next.preferred_language && !next.languages.includes(next.preferred_language as Language)) {
      next.languages = [...next.languages, next.preferred_language as Language];
    }
    setForm(next);
    setVoice({ ...voice, transcript: `${voice.transcript}\n\n${transcript}`, status, source });
    maybeStart(next);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setAuto((a) => ({ ...a, phase: "running" }));
    if (!(await save(form))) setAuto((a) => ({ ...a, phase: "cancelled" }));
  }

  const tooManyNeeds = form.expertise_needs.length > 5;
  const needOptions = [...NEED_OPTIONS, ...form.expertise_needs.filter((n) => !NEED_OPTIONS.includes(n))];
  const complete = isComplete(form);
  const secondsLeft = auto.secondsLeft;

  const answered = voice ? voice.asked.filter((f) => !isEmpty(form[f as keyof FormState])).length : 0;

  const submitButton = (
    <Button type="submit" className="w-full" busy={busy === "assessment" || busy === "matching"} disabled={tooManyNeeds || !complete}>
      {busy === "assessment" ? "Saving your answers..." : busy === "matching" ? "Finding mentors..." : "Find my mentors"}
    </Button>
  );

  // ----- the full form (typing, or reviewing a voice draft) -----
  const fullForm = (
    <div className="space-y-4">
      <div>
        <Label htmlFor="business_name">Business name (optional)</Label>
        <input id="business_name" className={inputClass} value={form.business_name} onChange={(e) => set("business_name", e.target.value)} />
        <FieldHint field="business_name" voice={voice} />
      </div>

      <div>
        <ChoiceChips
          legend="Sector"
          name="sector"
          options={SECTORS.map((s) => ({ value: s, label: SECTOR_LABEL[s] }))}
          value={form.sector}
          onChange={(v) => set("sector", v)}
        />
        <FieldHint field="sector" voice={voice} />
      </div>

      <div>
        <ChoiceChips
          legend="Stage"
          name="business_stage"
          options={STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }))}
          value={form.business_stage}
          onChange={(v) => set("business_stage", v as Stage)}
        />
        <FieldHint field="business_stage" voice={voice} />
      </div>

      <div>
        <Label htmlFor="description">What does your business do (or what would you like to do)?</Label>
        <textarea id="description" rows={3} className={inputClass} value={form.business_description} onChange={(e) => set("business_description", e.target.value)} required />
        <FieldHint field="business_description" voice={voice} />
      </div>

      <div>
        <Label htmlFor="challenge">What is your biggest challenge right now?</Label>
        <textarea id="challenge" rows={3} className={inputClass} value={form.primary_challenge} onChange={(e) => set("primary_challenge", e.target.value)} required />
        <FieldHint field="primary_challenge" voice={voice} />
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-medium">What help do you need? (up to 5)</legend>
        <div className="flex flex-wrap gap-2">
          {needOptions.map((need) => (
            <Chip key={need} on={form.expertise_needs.includes(need)} onClick={() => toggleNeed(need)}>
              {EXPERTISE_LABEL[need]}
            </Chip>
          ))}
        </div>
        {tooManyNeeds && <p className="mt-1 text-sm text-danger">Choose 5 or fewer.</p>}
        <FieldHint field="expertise_needs" voice={voice} />
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Languages you speak</legend>
          {LANGUAGES.map((l) => (
            <label key={l} className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-accent" checked={form.languages.includes(l)} onChange={() => toggleLanguage(l)} />
              {LANGUAGE_LABEL[l]}
            </label>
          ))}
          <FieldHint field="languages" voice={voice} />
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Preferred language</legend>
          {LANGUAGES.map((l) => (
            <label key={l} className="flex min-h-11 items-center gap-2 text-sm">
              <input type="radio" name="preferred_language" className="size-4 accent-accent" checked={form.preferred_language === l} onChange={() => choosePreferred(l)} />
              {LANGUAGE_LABEL[l]}
            </label>
          ))}
          <FieldHint field="preferred_language" voice={voice} />
        </fieldset>
      </div>

      <div>
        <Label htmlFor="budget">Budget per mentoring session (Nu., 0 if not sure)</Label>
        <input
          id="budget"
          type="number"
          min={0}
          step={100}
          inputMode="numeric"
          className={inputClass}
          value={form.budget}
          onChange={(e) => set("budget", e.target.value === "" ? "" : Number(e.target.value))}
        />
        <FieldHint field="budget" voice={voice} />
      </div>
    </div>
  );

  // ----- the agent's follow-up questions (only what is still needed) -----
  function question(field: DraftField): ReactNode {
    switch (field) {
      case "budget":
        return (
          <fieldset key={field}>
            <legend className="mb-1 text-sm font-medium">About how much could you spend per mentoring session?</legend>
            <div className="flex flex-wrap gap-2">
              {BUDGET_CHOICES.map((b) => (
                <Chip key={b} on={form.budget === b} onClick={() => set("budget", b)}>
                  {b === 0 ? "Not sure (YDF credit can help)" : formatNu(b)}
                </Chip>
              ))}
            </div>
          </fieldset>
        );
      case "preferred_language":
      case "languages":
        return (
          <fieldset key={field}>
            <legend className="mb-1 text-sm font-medium">Which language do you prefer for mentoring?</legend>
            <div className="flex flex-wrap gap-2">
              {LANGUAGES.map((l) => (
                <Chip key={l} on={form.preferred_language === l} onClick={() => choosePreferred(l)}>
                  {LANGUAGE_LABEL[l]}
                </Chip>
              ))}
            </div>
          </fieldset>
        );
      case "sector":
        return (
          <fieldset key={field}>
            <legend className="mb-1 text-sm font-medium">Which area is your business in, or interests you?</legend>
            <div className="flex flex-wrap gap-2">
              {SECTORS.map((s) => (
                <Chip key={s} on={form.sector === s} onClick={() => set("sector", s)}>
                  {SECTOR_LABEL[s]}
                </Chip>
              ))}
            </div>
          </fieldset>
        );
      case "business_stage":
        return (
          <fieldset key={field}>
            <legend className="mb-1 text-sm font-medium">Where are you now?</legend>
            <div className="flex flex-wrap gap-2">
              {STAGES.map((s) => (
                <Chip key={s} on={form.business_stage === s} onClick={() => set("business_stage", s)}>
                  {STAGE_QUESTION_LABEL[s]}
                </Chip>
              ))}
            </div>
          </fieldset>
        );
      case "expertise_needs":
        return (
          <fieldset key={field}>
            <legend className="mb-1 text-sm font-medium">What would help most right now? (up to 5)</legend>
            <div className="flex flex-wrap gap-2">
              {needOptions.map((need) => (
                <Chip key={need} on={form.expertise_needs.includes(need)} onClick={() => toggleNeed(need)}>
                  {EXPERTISE_LABEL[need]}
                </Chip>
              ))}
            </div>
          </fieldset>
        );
      case "business_description":
        return (
          <div key={field}>
            <Label htmlFor="q-description">In one sentence, what do you do or want to do?</Label>
            <input id="q-description" className={inputClass} value={form.business_description} onChange={(e) => set("business_description", e.target.value)} />
          </div>
        );
      case "primary_challenge":
        return (
          <div key={field}>
            <Label htmlFor="q-challenge">What is your biggest challenge right now?</Label>
            <input id="q-challenge" className={inputClass} value={form.primary_challenge} onChange={(e) => set("primary_challenge", e.target.value)} />
          </div>
        );
      default:
        return null;
    }
  }

  // Ask about language once, even if both "languages" and "preferred_language" are missing.
  const questions = voice ? voice.asked.filter((f, i, all) => !(f === "languages" && all.includes("preferred_language"))) : [];

  const understood: Array<[DraftField, string, string]> = voice
    ? ([
        ["business_name", "Business", form.business_name],
        ["business_stage", "Stage", form.business_stage ? STAGE_LABEL[form.business_stage as Stage] : ""],
        ["sector", "Area", form.sector ? (SECTOR_LABEL as Record<string, string>)[form.sector] ?? form.sector : ""],
        ["business_description", "About", form.business_description],
        ["primary_challenge", "Challenge", form.primary_challenge],
        ["expertise_needs", "Help needed", form.expertise_needs.map((n) => EXPERTISE_LABEL[n]).join(", ")],
        ["languages", "Speaks", form.languages.map((l) => LANGUAGE_LABEL[l]).join(", ")],
        ["preferred_language", "Prefers", form.preferred_language ? LANGUAGE_LABEL[form.preferred_language as Language] : ""],
        ["budget", "Budget", form.budget === "" ? "" : form.budget === 0 ? "Not sure yet" : `${formatNu(form.budget)} per session`],
      ] as Array<[DraftField, string, string]>).filter(([, , value]) => value)
    : [];

  return (
    <Card>
      <h1 className="text-lg font-semibold">{heading}</h1>
      <p className="mt-1 text-sm text-muted">
        Takes about two minutes, even if you only have an idea, or no idea yet. Your answers are used to find the right mentor and to brief them.
      </p>

      <section aria-labelledby="voice-intro" className="mt-4 space-y-2 rounded-xl bg-sunken p-3">
        <h2 id="voice-intro" className="text-sm font-semibold">
          Prefer to talk? Tell us about yourself by voice
        </h2>
        <p className="text-xs text-muted">
          In English, up to 2 minutes: what you do or want to do, your biggest challenge, the help you need, the languages you speak and your
          budget per session. The agent fills in what it can and asks only what it still needs.
        </p>
        <VoiceRecorder
          available={live}
          onText={(t) => draftFrom(t, false)}
          title="Record or upload your introduction"
          hint="The audio is sent to Groq (Whisper) to turn it into text. Only the text is used."
          language="en"
          maxSeconds={120}
        />
        <div className="flex flex-wrap gap-1">
          <Button type="button" variant="ghost" busy={busy === "voice-draft"} onClick={() => draftFrom(DEMO_VOICE_INTRO, false)}>
            {busy === "voice-draft" ? "Reading your introduction..." : "Use a sample intro"}
          </Button>
          <Button type="button" variant="ghost" disabled={busy === "voice-draft"} onClick={() => draftFrom(DEMO_ASPIRING_INTRO, false)}>
            Try a sample without a business
          </Button>
        </div>
      </section>

      <form onSubmit={submit} className="mt-4 space-y-4">
        {voice ? (
          <>
            <section aria-labelledby="understood" className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="understood" className="text-base font-semibold">
                  Here is what I understood
                </h2>
                <SourceBadge source={voice.source} />
              </div>
              <dl className="divide-y divide-line rounded-xl border border-line">
                {understood.map(([field, label, value]) => (
                  <div key={field} className="flex items-start justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <dt className="text-xs text-muted">{label}</dt>
                      <dd className="text-sm">{value}</dd>
                    </div>
                    <Badge
                      tone={voice.status[field] === "suggested" ? "warning" : voice.status[field] === "assumed" ? "info" : "neutral"}
                      className="mt-0.5 shrink-0"
                    >
                      {voice.status[field] === "suggested" ? "Suggested" : voice.status[field] === "assumed" ? "Assumed" : "Heard"}
                    </Badge>
                  </div>
                ))}
              </dl>
              <details className="text-sm">
                <summary className="cursor-pointer font-medium text-accent">What we heard</summary>
                <p className="mt-1 whitespace-pre-line text-muted">{voice.transcript}</p>
              </details>
            </section>

            {questions.length > 0 && (
              <section aria-labelledby="questions" className="space-y-3 rounded-xl border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 id="questions" className="text-base font-semibold">
                    {questions.length === 1 ? "One quick question" : `${questions.length} quick questions`}
                  </h2>
                  <span className="text-xs text-muted">
                    {Math.min(answered, questions.length)} of {questions.length} answered
                  </span>
                </div>
                {questions.map((f) => question(f))}
                <VoiceRecorder
                  available={live}
                  onText={(t) => draftFrom(t, true)}
                  title="Or answer by voice"
                  hint="Say your answers in English, for example: I prefer English, and I can spend about one thousand ngultrum."
                  language="en"
                  maxSeconds={60}
                />
              </section>
            )}

            {auto.phase === "counting" && (
              <div role="status" className="space-y-2 rounded-xl bg-success-soft p-3 text-success">
                <p className="text-sm font-semibold">That is enough to find your mentors. Finding them in {secondsLeft} s.</p>
                <p className="text-xs">Anything marked Assumed or Suggested can be changed now or later.</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void runAuto()}>
                    Find them now
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setAuto((a) => ({ ...a, phase: "cancelled" }))}>
                    Wait, let me check first
                  </Button>
                </div>
              </div>
            )}
            {(auto.phase === "running" || busy === "assessment" || busy === "matching") && (
              <Notice tone="info">{busy === "assessment" ? "Saving your answers..." : "Finding your mentors..."}</Notice>
            )}
            {auto.phase === "cancelled" && submitButton}
            <details className="rounded-xl border border-line p-3">
              <summary className="cursor-pointer text-sm font-medium text-accent">Review or change all answers</summary>
              <div className="mt-3">{fullForm}</div>
            </details>
          </>
        ) : (
          <>
            {fullForm}
            {submitButton}
          </>
        )}
      </form>
    </Card>
  );
}
