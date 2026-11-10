"use client";

import { useState, type FormEvent } from "react";
import { PEMA_ASSESSMENT_ANSWERS } from "@/lib/demo/fixtures";
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
} from "@/lib/types";
import { useDemo } from "../demo-state";
import { Button, Card, ChoiceChips, Label, inputClass } from "../ui";

// Pre-filled with Pema's answers so the live demo is fast, but every field is
// editable and validated on the server.

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

export function AssessmentForm() {
  const { act, busy } = useDemo();
  const [form, setForm] = useState(() => ({
    ...PEMA_ASSESSMENT_ANSWERS,
    goals: [...PEMA_ASSESSMENT_ANSWERS.goals],
    expertise_needs: [...PEMA_ASSESSMENT_ANSWERS.expertise_needs] as Expertise[],
    languages: [...PEMA_ASSESSMENT_ANSWERS.languages],
  }));
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const toggleNeed = (need: Expertise) =>
    set(
      "expertise_needs",
      form.expertise_needs.includes(need) ? form.expertise_needs.filter((n) => n !== need) : [...form.expertise_needs, need],
    );
  const toggleLanguage = (lang: Language) =>
    set("languages", form.languages.includes(lang) ? form.languages.filter((l) => l !== lang) : [...form.languages, lang]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const payload = { ...form, goals: form.goals.map((g) => g.trim()).filter(Boolean) };
    const saved = await act("assessment", "/api/assessment", payload);
    if (saved.ok) await act("matching", "/api/matches");
  }

  const tooManyNeeds = form.expertise_needs.length > 5;

  return (
    <Card>
      <h1 className="text-lg font-semibold">Tell us about your business</h1>
      <p className="mt-1 text-sm text-muted">Takes about two minutes. Your answers are used to find the right mentor and to brief them.</p>

      <form onSubmit={submit} className="mt-4 space-y-4">
        <div>
          <Label htmlFor="business_name">Business name</Label>
          <input id="business_name" className={inputClass} value={form.business_name} onChange={(e) => set("business_name", e.target.value)} required />
        </div>

        <ChoiceChips
          legend="Sector"
          name="sector"
          options={SECTORS.map((s) => ({ value: s, label: SECTOR_LABEL[s] }))}
          value={form.sector}
          onChange={(v) => set("sector", v)}
        />

        <ChoiceChips
          legend="Stage"
          name="business_stage"
          options={STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }))}
          value={form.business_stage}
          onChange={(v) => set("business_stage", v as typeof form.business_stage)}
        />

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
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">What help do you need? (up to 5)</legend>
          <div className="flex flex-wrap gap-2">
            {NEED_OPTIONS.map((need) => {
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
            onChange={(e) => set("budget", Number(e.target.value))}
          />
        </div>

        <Button
          type="submit"
          className="w-full"
          busy={busy === "assessment" || busy === "matching"}
          disabled={tooManyNeeds || form.expertise_needs.length === 0 || form.languages.length === 0}
        >
          {busy === "assessment" ? "Saving your answers..." : busy === "matching" ? "Finding mentors..." : "Find my mentors"}
        </Button>
      </form>
    </Card>
  );
}
