"use client";

import { useState } from "react";
import { ArrowRight, Check, Compass, Sparkles, Users } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDemo } from "@/components/demo-state";
import { VoiceRecorder } from "@/components/voice/voice-recorder";
import { COACH_STEPS } from "@/lib/coach-steps";
import { COACH_REPLY_MAX_CHARS } from "@/lib/agent/schemas";
import type { CoachStepView } from "@/lib/state-types";

// The beginner coach screen (someone with no business idea yet). The agent sets
// one small step at a time and reads what they report back; after step 4 a
// human mentor takes over (see src/lib/agent/coach.ts).

export function BeginnerCoach({ onMentor, onUpdateNeeds }: { onMentor: () => void; onUpdateNeeds: () => void }) {
  const { state, act, busy } = useDemo();
  const coach = state?.coach ?? null;
  const [draft, setDraft] = useState("");
  const [source, setSource] = useState<"typed" | "voice_note">("typed");
  const open = coach?.steps.find((s) => s.status === "open") ?? null;
  const done = coach?.steps.filter((s) => s.status === "done") ?? [];
  const firstName = state?.entrepreneur?.full_name.split(" ")[0] ?? "";

  async function send(step: number) {
    const res = await act("coach-reply", "/api/coach/reply", { step, reply: draft.trim(), source });
    if (res.ok) {
      setDraft("");
      setSource("typed");
    }
  }

  async function askMentor() {
    const res = await act("coach-skip", "/api/coach/skip");
    if (res.ok) onMentor();
  }

  const progress = (
    <ol className="coach-progress" aria-label="Your four first steps">
      {COACH_STEPS.map((s) => {
        const row = coach?.steps.find((x) => x.step === s.step);
        const state_ = row?.status === "done" ? "done" : row?.status === "open" ? "current" : "upcoming";
        return (
          <li key={s.step} className={`coach-progress-item ${state_}`} aria-current={state_ === "current" ? "step" : undefined}>
            <span className="coach-progress-dot">{state_ === "done" ? <Check className="size-3.5" /> : s.step}</span>
            <span>{s.title}</span>
          </li>
        );
      })}
    </ol>
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Find an idea worth testing</h1>
          <p className="subtitle">Four small steps with your AI coach. Then a human mentor takes over.</p>
        </div>
      </div>

      <Alert className="mb-6">
        <Sparkles className="size-4" />
        <AlertTitle>This is an AI coach, not your mentor</AlertTitle>
        <AlertDescription>
          It sets one small task at a time and reads what you report back. It never gives tax or legal advice: those questions go to a person at YDF.
          After step 4, it introduces you to a verified mentor and shares what you found.
        </AlertDescription>
      </Alert>

      {!coach && (
        <Card className="form-card">
          <CardHeader>
            <Compass className="size-8 text-primary" />
            <CardTitle>No idea yet? Start here</CardTitle>
            <CardDescription>
              Most good businesses start from a problem, not a product. In about a week, you will notice problems around you, talk to three people,
              pick one idea and try a small test. Each step takes one to three days and costs little or nothing.
            </CardDescription>
          </CardHeader>
          <CardContent className="stack">
            {progress}
            <div className="row wrap">
              <Button disabled={Boolean(busy)} onClick={() => void act("coach-start", "/api/coach/start")}>
                {busy === "coach-start" ? "Preparing your first step…" : "Start my first step"}
                <ArrowRight className="size-4" />
              </Button>
              <Button variant="ghost" disabled={Boolean(busy)} onClick={() => void askMentor()}>
                Ask a human mentor now
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {coach?.status === "skipped" && (
        <Card className="form-card">
          <CardHeader>
            <Users className="size-8 text-primary" />
            <CardTitle>You asked for a mentor directly</CardTitle>
            <CardDescription>The agent is asking a mentor for you. You can still come back to these steps at any time.</CardDescription>
          </CardHeader>
          <CardContent className="row wrap">
            <Button onClick={onMentor}>
              See your mentor request
              <ArrowRight className="size-4" />
            </Button>
            <Button variant="ghost" disabled={Boolean(busy)} onClick={() => void act("coach-start", "/api/coach/start")}>
              Continue the steps
            </Button>
          </CardContent>
        </Card>
      )}

      {coach && coach.status !== "skipped" && progress}

      {coach?.status === "active" && open && (
        <OpenStep
          step={open}
          draft={draft}
          busy={busy}
          available={state?.ai_mode === "live"}
          onDraft={(text, from) => {
            setDraft(text);
            setSource(from);
          }}
          onSend={() => void send(open.step)}
        />
      )}
      {coach?.status === "active" && !open && <p className="muted">Preparing your next step…</p>}

      {coach?.status === "ready" && coach.summary && (
        <Card className="form-card coach-ready">
          <CardHeader>
            <Badge variant="secondary" className="status-success self-start">All four steps done</Badge>
            <CardTitle>Well done{firstName ? `, ${firstName}` : ""}. You are ready for a mentor.</CardTitle>
            <CardDescription>The agent is asking a mentor to meet you and will share this, so you do not have to repeat it.</CardDescription>
          </CardHeader>
          <CardContent className="stack">
            <div className="info-pair"><span>The problem</span><strong>{coach.summary.problem}</strong></div>
            <div className="info-pair"><span>Who has it</span><strong>{coach.summary.who_has_it}</strong></div>
            <div className="info-pair"><span>Your idea</span><strong>{coach.summary.idea}</strong></div>
            <div>
              <h3>What you found</h3>
              <ul className="mt-2 list-disc pl-5 space-y-1 muted">{coach.summary.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
            <div>
              <h3>Questions for your mentor</h3>
              <ul className="mt-2 list-disc pl-5 space-y-1 muted">{coach.summary.questions_for_mentor.map((q) => <li key={q}>{q}</li>)}</ul>
            </div>
            <Button className="self-start" onClick={onMentor}>
              See your mentor request
              <ArrowRight className="size-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {done.length > 0 && (
        <Card className="form-card">
          <CardHeader>
            <CardTitle>What you have found so far</CardTitle>
          </CardHeader>
          <CardContent className="stack">
            {done.map((s) => (
              <div key={s.step} className="coach-done">
                <h3>{s.step}. {s.title}</h3>
                {s.learnings.length > 0 ? (
                  <ul className="mt-1 list-disc pl-5 space-y-1 muted">{s.learnings.map((l) => <li key={l}>{l}</li>)}</ul>
                ) : (
                  <p className="muted">{s.last_reply}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="row wrap mt-6">
        {coach?.status === "active" && (
          <Button variant="ghost" disabled={Boolean(busy)} onClick={() => void askMentor()}>
            Ask a human mentor now
          </Button>
        )}
        <Button variant="link" className="px-0" onClick={onUpdateNeeds}>
          Have an idea now? Update your needs
        </Button>
      </div>
    </>
  );
}

function OpenStep({
  step,
  draft,
  busy,
  available,
  onDraft,
  onSend,
}: {
  step: CoachStepView;
  draft: string;
  busy: string | null;
  available: boolean;
  onDraft: (text: string, source: "typed" | "voice_note") => void;
  onSend: () => void;
}) {
  const reading = busy === "coach-reply";
  return (
    <Card className="form-card coach-step">
      <CardHeader>
        <p className="kicker">STEP {step.step} OF 4</p>
        <CardTitle>{step.title}</CardTitle>
        <CardDescription className="coach-mission">{step.mission}</CardDescription>
      </CardHeader>
      <CardContent className="stack">
        {step.why && <div className="info-pair"><span>Why it matters</span><strong>{step.why}</strong></div>}
        <div className="info-pair"><span>Report back when</span><strong>{step.done_when}</strong></div>
        {step.example && <p className="muted text-sm">Example of a report: “{step.example}”</p>}

        {step.attempts > 0 && step.feedback && (
          <Alert>
            <AlertTitle>Your coach says</AlertTitle>
            <AlertDescription>{step.feedback}</AlertDescription>
          </Alert>
        )}

        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
          }}
        >
          <div className="field">
            <Label htmlFor="coach-reply">What did you find?</Label>
            <Textarea
              id="coach-reply"
              value={draft}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onDraft(e.target.value, "typed")}
              rows={6}
              maxLength={COACH_REPLY_MAX_CHARS}
              placeholder="Write it the way you would tell a friend. Rough notes are fine."
              required
            />
          </div>
          <VoiceRecorder
            available={available}
            onText={(text: string) => onDraft(draft.trim() ? `${draft.trim()}\n${text}` : text, "voice_note")}
            title="Or say it"
            recordLabel="Record your report"
            hint="Your words appear in the box above. Check them, then send."
            language="en"
            maxSeconds={300}
            unavailableText="Speaking your report is available when live AI is switched on."
          />
          <Button type="submit" className="self-start" disabled={Boolean(busy) || !draft.trim()}>
            {reading ? "Your coach is reading it…" : "Send to my coach"}
            <ArrowRight className="size-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
