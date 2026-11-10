"use client";

import { useState, type FormEvent } from "react";
import type { DraftField } from "@/lib/agent/assessment-rules";
import type { AssessmentDraft } from "@/lib/agent/schemas";
import { DEMO_VOICE_INTRO, PEMA_ASSESSMENT_ANSWERS } from "@/lib/demo/fixtures";
import {
  EXPERTISE_LABEL,
  LANGUAGE_LABEL,
  LANGUAGES,
  SECTOR_LABEL,
  SECTORS,
  STAGE_LABEL,
  STAGES,
  type Expertise,
  type Language,
  type Stage,
} from "@/lib/types";
import { useDemo } from "../demo-state";
import { Button, Card, ChoiceChips, Label, Notice, SourceBadge, inputClass } from "../ui";
import { VoiceRecorder } from "../voice/voice-recorder";

// Pre-filled with Pema's answers so the live demo is fast. Pema can also
// introduce the business by voice (English for now): the agent drafts the form,
// marks what was not mentioned, and Pema checks and edits before submitting.

const NEED_OPTIONS: Expertise[] = [
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

interface FormState {
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

const initialForm = (): FormState => ({
  ...PEMA_ASSESSMENT_ANSWERS,
  goals: [...PEMA_ASSESSMENT_ANSWERS.goals],
  expertise_needs: [...PEMA_ASSESSMENT_ANSWERS.expertise_needs] as Expertise[],
  languages: [...PEMA_ASSESSMENT_ANSWERS.languages],
});

interface VoiceState {
  transcript: string;
  missing: Set<DraftField>;
  source: "live_ai" | "fallback";
}

function FieldHint({ field, voice }: { field: DraftField; voice: VoiceState | null }) {
  if (!voice) return null;
  if (voice.missing.has(field)) return <p className="mt-1 text-xs font-medium text-warning">Not mentioned, please fill in</p>;
  return <p className="mt-1 text-xs text-muted">From your voice intro</p>;
}

export function AssessmentForm() {
  const { act, busy, state } = useDemo();
  const [form, setForm] = useState<FormState>(initialForm);
  const [voice, setVoice] = useState<VoiceState | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    // Once Pema answers a "Not mentioned" field, the warning goes away.
    setVoice((v) => {
      if (!v || !v.missing.has(key as DraftField)) return v;
      const missing = new Set(v.missing);
      missing.delete(key as DraftField);
      return { ...v, missing };
    });
  };

  const toggleNeed = (need: Expertise) =>
    set(
      "expertise_needs",
      form.expertise_needs.includes(need) ? form.expertise_needs.filter((n) => n !== need) : [...form.expertise_needs, need],
    );
  const toggleLanguage = (lang: Language) =>
    set("languages", form.languages.includes(lang) ? form.languages.filter((l) => l !== lang) : [...form.languages, lang]);

  async function draftFrom(transcript: string) {
    const res = await act("voice-draft", "/api/assessment/draft", { transcript });
    if (!res.ok) return;
    const { draft, missing, source } = res as unknown as { draft: AssessmentDraft; missing: DraftField[]; source: VoiceState["source"] };
    setForm({
      business_name: draft.business_name ?? "",
      sector: draft.sector ?? "",
      business_stage: draft.business_stage ?? "",
      business_description: draft.business_description ?? "",
      primary_challenge: draft.primary_challenge ?? "",
      goals: draft.goals ?? [],
      expertise_needs: draft.expertise_needs ?? [],
      languages: draft.languages ?? [],
      preferred_language: draft.preferred_language ?? "",
      budget: draft.budget ?? "",
    });
    setVoice({ transcript, missing: new Set(missing), source });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const payload = { ...form, budget: Number(form.budget), goals: form.goals.map((g) => g.trim()).filter(Boolean) };
    const saved = await act("assessment", "/api/assessment", payload);
    if (saved.ok) await act("matching", "/api/matches");
  }

  const tooManyNeeds = form.expertise_needs.length > 5;
  const needOptions = [...NEED_OPTIONS, ...form.expertise_needs.filter((n) => !NEED_OPTIONS.includes(n))];
  const complete =
    form.business_name.trim() !== "" &&
    form.sector !== "" &&
    form.business_stage !== "" &&
    form.business_description.trim() !== "" &&
    form.primary_challenge.trim() !== "" &&
    form.expertise_needs.length > 0 &&
    form.languages.length > 0 &&
    form.preferred_language !== "" &&
    form.languages.includes(form.preferred_language as Language) &&
    form.budget !== "";

  return (
    <Card>
      <h1 className="text-lg font-semibold">Tell us about your business</h1>
      <p className="mt-1 text-sm text-muted">Takes about two minutes. Your answers are used to find the right mentor and to brief them.</p>

      <section aria-labelledby="voice-intro" className="mt-4 space-y-2 rounded-xl bg-sunken p-3">
        <h2 id="voice-intro" className="text-sm font-semibold">
          Prefer to talk? Tell us about your business by voice
        </h2>
        <p className="text-xs text-muted">
          In English, up to 2 minutes: what you do, your biggest challenge, the help you need, the languages you speak and your budget per
          session. We fill in the form for you to check.
        </p>
        <VoiceRecorder
          available={state?.ai_mode === "live"}
          onText={draftFrom}
          title="Record or upload your introduction"
          hint="The audio is sent to Groq (Whisper) to turn it into text. Only the text is used."
          language="en"
          maxSeconds={120}
        />
        <Button type="button" variant="ghost" busy={busy === "voice-draft"} onClick={() => draftFrom(DEMO_VOICE_INTRO)}>
          {busy === "voice-draft" ? "Reading your introduction..." : "Use a sample intro"}
        </Button>
        {voice && (
          <>
            <Notice tone={voice.missing.size > 0 ? "warning" : "success"}>
              <span className="flex flex-wrap items-center gap-2">
                {voice.missing.size > 0
                  ? `We filled in what you said. ${voice.missing.size} answer${voice.missing.size === 1 ? " is" : "s are"} marked "Not mentioned": please add ${voice.missing.size === 1 ? "it" : "them"}.`
                  : "We filled in everything from what you said. Please check each answer."}
                <SourceBadge source={voice.source} />
              </span>
            </Notice>
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-accent">What we heard</summary>
              <p className="mt-1 text-muted">{voice.transcript}</p>
            </details>
          </>
        )}
      </section>

      <form onSubmit={submit} className="mt-4 space-y-4">
        <div>
          <Label htmlFor="business_name">Business name</Label>
          <input id="business_name" className={inputClass} value={form.business_name} onChange={(e) => set("business_name", e.target.value)} required />
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
          <Label htmlFor="description">What does your business do?</Label>
          <textarea
            id="description"
            rows={3}
            className={inputClass}
            value={form.business_description}
            onChange={(e) => set("business_description", e.target.value)}
            required
          />
          <FieldHint field="business_description" voice={voice} />
        </div>

        <div>
          <Label htmlFor="challenge">What is your biggest challenge right now?</Label>
          <textarea
            id="challenge"
            rows={3}
            className={inputClass}
            value={form.primary_challenge}
            onChange={(e) => set("primary_challenge", e.target.value)}
            required
          />
          <FieldHint field="primary_challenge" voice={voice} />
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">What help do you need? (up to 5)</legend>
          <div className="flex flex-wrap gap-2">
            {needOptions.map((need) => {
              const on = form.expertise_needs.includes(need);
              return (
                <button
                  type="button"
                  key={need}
                  aria-pressed={on}
                  onClick={() => toggleNeed(need)}
                  className={
                    on
                      ? "min-h-11 rounded-full border border-accent bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent-strong"
                      : "min-h-11 rounded-full border border-line bg-card px-3 py-1.5 text-sm text-muted hover:text-ink"
                  }
                >
                  {EXPERTISE_LABEL[need]}
                </button>
              );
            })}
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
                <input
                  type="radio"
                  name="preferred_language"
                  className="size-4 accent-accent"
                  checked={form.preferred_language === l}
                  onChange={() => set("preferred_language", l)}
                />
                {LANGUAGE_LABEL[l]}
              </label>
            ))}
            <FieldHint field="preferred_language" voice={voice} />
          </fieldset>
        </div>

        <div>
          <Label htmlFor="budget">Budget per mentoring session (Nu.)</Label>
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

        <Button type="submit" className="w-full" busy={busy === "assessment" || busy === "matching"} disabled={tooManyNeeds || !complete}>
          {busy === "assessment" ? "Saving your answers..." : busy === "matching" ? "Finding mentors..." : "Find my mentors"}
        </Button>
      </form>
    </Card>
  );
}
