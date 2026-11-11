import "server-only";
import { groundPoints } from "./grounding";
import { structured, MODELS } from "./llm";
import { NO_GENDER_RULE } from "./prompts";
import { SessionRecapSchema, type SessionRecap } from "./schemas";

// Session recap: after every session the agent writes what was discussed and
// what the session achieved, from the call transcript (or the mentor's notes).
// Both people see it in their session history. Like every agent step it has a
// rule-based fallback, and nothing it writes may add facts nobody said.

/** The most the recap reads in one go. Longer sessions: the start and the end. */
export const RECAP_INPUT_MAX = 24_000;

export function recapInput(text: string): string {
  const t = text.trim();
  if (t.length <= RECAP_INPUT_MAX) return t;
  const half = RECAP_INPUT_MAX / 2;
  return `${t.slice(0, half)}\n[... the middle of the session is left out ...]\n${t.slice(-half)}`;
}

/** Live points must come from the text; if nothing is left, the fallback is used. */
export function groundRecap(recap: SessionRecap, text: string): SessionRecap | null {
  const discussed = groundPoints(recap.discussed, text, 5);
  if (discussed.length === 0) return null;
  return { discussed, achieved: groundPoints(recap.achieved, text, 4) };
}

/** No AI: the agent's summary (or the first lines of the notes) as what was discussed. */
export function fallbackRecap(notes: string, summary?: string | null): SessionRecap {
  // "No clear agreed actions were found" says nothing about what was discussed.
  const useful = summary?.trim() && !/^No clear agreed actions/i.test(summary.trim()) ? summary.trim() : "";
  const from = useful || notes.replace(/^\[(Mentor|Entrepreneur)\]\s*/gm, "").replace(/^(Mentor notes|Call transcript):\s*$/gm, "");
  const sentences = from
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
  const discussed = sentences.slice(0, 3).map((s) => s.slice(0, 200));
  return { discussed: discussed.length ? discussed : ["The session notes are below."], achieved: [] };
}

export const recapLive = (text: string) => (signal: AbortSignal) =>
  structured({
    task: "session_recap",
    model: MODELS.light,
    maxTokens: 700,
    schema: SessionRecapSchema,
    signal,
    system:
      "You write a short recap of one mentoring session in Bhutan between a mentor and an entrepreneur, from the call transcript " +
      "(speakers labelled [Mentor] and [Entrepreneur]; it may contain transcription errors) or from the mentor's notes. " +
      "discussed: 2 to 5 short points on the topics and questions they talked about. " +
      "achieved: 0 to 4 short points on what the session achieved: decisions made, progress the entrepreneur reported, " +
      "and what they learned or now feel clearer or more confident about. Leave it empty if the text shows nothing achieved. " +
      "Each point is one plain sentence under 150 characters that names no one and addresses no one " +
      '(for example "Ways to get visitors to stay longer in the village"). ' +
      "Use only what the text says. Never invent names, numbers, places, prices or results.\n\n" +
      NO_GENDER_RULE,
    user: recapInput(text),
  });
