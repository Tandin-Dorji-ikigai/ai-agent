import "server-only";
import { groundPoints } from "./grounding";
import { structured, MODELS } from "./llm";
import { NO_GENDER_RULE } from "./prompts";
import { SessionRecapDraftSchema, SessionRecapSchema, type SessionRecap, type SessionRecapDraft } from "./schemas";

// Session summary: after every session the agent writes what was discussed, the
// mentor's main advice, what the session achieved, one suggested next step and a
// recommended follow-up date, from the call transcript (or the mentor's notes).
// It needs no action tracking, so a session that was only a conversation still
// ends with clear advice and a next step. Both people see it in their session
// history. Like every agent step it has a rule-based fallback, and nothing it
// writes may add facts nobody said.

/** The most the recap reads in one go. Longer sessions: the start and the end. */
export const RECAP_INPUT_MAX = 24_000;

/** When nobody said when to meet again: two weeks, time to try the next step. */
export const DEFAULT_FOLLOW_UP_DAYS = 14;
const MIN_FOLLOW_UP_DAYS = 7;
const MAX_FOLLOW_UP_DAYS = 60;

export function recapInput(text: string): string {
  const t = text.trim();
  if (t.length <= RECAP_INPUT_MAX) return t;
  const half = RECAP_INPUT_MAX / 2;
  return `${t.slice(0, half)}\n[... the middle of the session is left out ...]\n${t.slice(-half)}`;
}

const SPEAKER = /^\[(Mentor|Entrepreneur)\]\s*/;
const sentencesOf = (text: string) =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
const clip = (s: string) => (s.length <= 200 ? s : `${s.slice(0, 197).trimEnd()}…`);

/** What the mentor said: their lines in a transcript, or all of the mentor's own notes. */
function mentorText(notes: string): string {
  const lines = notes.split("\n");
  const labelled = lines.some((l) => SPEAKER.test(l));
  return labelled
    ? lines
        .filter((l) => l.startsWith("[Mentor]"))
        .map((l) => l.replace(SPEAKER, ""))
        .join("\n")
    : notes.replace(/^(Mentor notes|Call transcript):\s*$/gm, "");
}

const ADVICE = /\b(you should|you could|you might|i suggest|i'd suggest|i would suggest|i recommend|my advice|try to|make sure|focus on|start with|start by|don't|do not|consider|it's worth|advised|suggested|recommended)\b/i;
const NEXT = /\b(next step|before (we|our) next|this week|by next|go and|first thing)\b/i;

const NUMBER: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, "a couple of": 2, "a few": 3 };
const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, month: 30 };
const MEETING = /\b(meet|talk|speak|session|call|catch up|check in|follow[- ]up|see you)\b/i;

/** A time to meet again that was said out loud ("let's meet again in two weeks"), in days. */
export function saidFollowUpDays(text: string): number | null {
  for (const s of sentencesOf(text.replace(/^\[(Mentor|Entrepreneur)\]\s*/gm, ""))) {
    if (!MEETING.test(s)) continue;
    const next = s.match(/\bnext (week|month)\b/i);
    if (next) return UNIT_DAYS[next[1].toLowerCase()];
    const m = s.match(/\b(?:in|after)\s+(?:about\s+|around\s+|roughly\s+)?(\d{1,2}|a couple of|a few|an?|one|two|three|four|five|six)\s+(day|week|month)s?\b/i);
    if (m) {
      const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER[m[1].toLowerCase()];
      if (n) return n * UNIT_DAYS[m[2].toLowerCase()];
    }
  }
  return null;
}

/** No AI: the agent's summary (or the first lines) as what was discussed, the mentor's advice by simple rules. */
export function fallbackRecap(notes: string, summary?: string | null): SessionRecapDraft {
  // "No clear agreed actions were found" says nothing about what was discussed.
  const useful = summary?.trim() && !/^No clear agreed actions/i.test(summary.trim()) ? summary.trim() : "";
  const from = useful || notes.replace(/^\[(Mentor|Entrepreneur)\]\s*/gm, "").replace(/^(Mentor notes|Call transcript):\s*$/gm, "");
  const mentorSaid = sentencesOf(mentorText(notes));
  const advice = mentorSaid.filter((s) => ADVICE.test(s)).slice(0, 3).map(clip);
  // Topics, not questions, and not the advice again.
  const discussed = sentencesOf(from)
    .filter((s) => s.length > 25 && !s.endsWith("?") && !advice.includes(clip(s)))
    .slice(0, 3)
    .map(clip);
  const next = mentorSaid.find((s) => NEXT.test(s)) ?? advice[0];
  return {
    discussed: discussed.length ? discussed : ["The session notes are below."],
    achieved: [],
    advice,
    next_step: next ? clip(next) : undefined,
  };
}

/** Live points must come from the text; anything not grounded is dropped (or filled from the fallback). */
export function groundRecap(recap: SessionRecapDraft, text: string, summary?: string | null): SessionRecapDraft {
  const discussed = groundPoints(recap.discussed, text, 5);
  const nextStep = recap.next_step ? groundPoints([recap.next_step], text, 1)[0] : undefined;
  const reason = recap.follow_up_reason ? groundPoints([recap.follow_up_reason], text, 1)[0] : undefined;
  return {
    discussed: discussed.length ? discussed : fallbackRecap(text, summary).discussed,
    achieved: groundPoints(recap.achieved, text, 4),
    advice: groundPoints(recap.advice, text, 4),
    next_step: nextStep,
    follow_up_in_days: recap.follow_up_in_days,
    follow_up_reason: reason,
  };
}

/** YYYY-MM-DD in Bhutan time. */
function bhutanDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Thimphu", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * The saved summary. The follow-up date counts from the session: the time they
 * agreed if they said one, else the agent's recommendation (7 to 60 days), else two weeks.
 */
export function finishRecap(draft: SessionRecapDraft, text: string, heldAt: Date): SessionRecap {
  const said = saidFollowUpDays(text);
  const suggested = draft.follow_up_in_days ? Math.min(MAX_FOLLOW_UP_DAYS, Math.max(MIN_FOLLOW_UP_DAYS, draft.follow_up_in_days)) : null;
  const days = said ?? suggested ?? DEFAULT_FOLLOW_UP_DAYS;
  const reason = said
    ? "You talked about meeting again around then."
    : suggested
      ? (draft.follow_up_reason ?? "A good time to look back at how the next step went.")
      : "Two weeks gives time to try the next step before you talk again.";
  return SessionRecapSchema.parse({
    discussed: draft.discussed,
    achieved: draft.achieved,
    advice: draft.advice,
    next_step: draft.next_step ?? null,
    follow_up_on: bhutanDate(new Date(heldAt.getTime() + days * 86_400_000)),
    follow_up_reason: reason,
  });
}

export const recapLive = (text: string) => (signal: AbortSignal) =>
  structured({
    task: "session_recap",
    model: MODELS.light,
    maxTokens: 900,
    schema: SessionRecapDraftSchema,
    signal,
    system:
      "You write a short summary of one mentoring session in Bhutan between a mentor and an entrepreneur, from the call transcript " +
      "(speakers labelled [Mentor] and [Entrepreneur]; it may contain transcription errors) or from the mentor's notes. " +
      "discussed: 1 to 5 short points on the topics and questions they talked about. " +
      "advice: 0 to 4 short points: the main advice the mentor gave, as suggestions (for example \"Start with two small village walks before adding meals\"). Only advice the mentor actually gave. " +
      "achieved: 0 to 4 short points on what the session achieved: decisions made, progress the entrepreneur reported, " +
      "and what they learned or now feel clearer or more confident about. Leave it empty if the text shows nothing achieved. " +
      "next_step: the one most useful next step for the entrepreneur, from what was said, starting with a verb. Leave it out if nothing fits. " +
      "follow_up_in_days: when a follow-up session would help: the time they agreed if they said one, otherwise your recommendation " +
      "from 7 to 60 days, based on how long the next step needs. follow_up_reason: one short sentence on why then. " +
      "Each point is one plain sentence under 150 characters that names no one and addresses no one. " +
      "Use only what the text says. Never invent names, numbers, places, prices or results.\n\n" +
      NO_GENDER_RULE,
    user: recapInput(text),
  });
