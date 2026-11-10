// Saved / template responses used when live AI is off, slow or returns invalid
// output (CLAUDE_WORKING_PLAN.md, "AI fallback policy").
//
// Every fallback is built ONLY from supplied data, so it can never invent
// qualifications or reasons. Outputs match the same schemas as live AI.

import { DEMO_CALL_TRANSCRIPT, DEMO_EXTRACTED_ACTIONS, DEMO_SESSION_NOTES } from "../demo/fixtures";
import type { ScoredMentor } from "../matching/score-mentor";
import type { AgendaItem } from "../progress";
import { heuristicExtraction } from "./transcripts";
import {
  LANGUAGE_LABEL,
  expertiseLabel,
  sectorLabel,
  stageLabel,
  type EntrepreneurRecord,
  type MentorRecord,
} from "../types";
import type { AssessmentSummary, Briefs, Extraction, FollowUp, MatchExplanations } from "./schemas";

const nu = (n: number) => `Nu. ${n.toLocaleString("en-IN")}`;

/** "early stage" -> "early-stage" when used before a noun. */
const stageAdj = (stage: string | null) => stageLabel(stage).toLowerCase().replace(" ", "-");
const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Assessment summary
// ---------------------------------------------------------------------------

/** "tourism " or "" when no sector has been chosen yet. */
const sectorWord = (sector: string | null) => (!sector || sector === "undecided" ? "" : `${sectorLabel(sector).toLowerCase()} `);

export function fallbackAssessmentSummary(e: EntrepreneurRecord): AssessmentSummary {
  const needs = listJoin(e.expertise_needs.map((n) => expertiseLabel(n).toLowerCase()));
  const stage = stageAdj(e.business_stage);
  const sw = sectorWord(e.sector);
  const intro = e.business_name
    ? `${e.full_name} runs ${e.business_name}, ${article(stage)} ${stage} ${sw}business.`
    : e.business_stage === "idea"
      ? `${e.full_name} is an aspiring entrepreneur at the idea stage${sw ? `, interested in ${sw.trim()}` : ""}.`
      : `${e.full_name} runs ${article(stage)} ${stage} ${sw}business.`;
  const parts = [
    intro,
    e.primary_challenge ? `Main challenge: ${e.primary_challenge.replace(/\.$/, "")}.` : "",
    needs ? `Looking for help with ${needs}.` : "",
    `Prefers ${LANGUAGE_LABEL[e.preferred_language]}; ${e.budget > 0 ? `budget ${nu(e.budget)} per session` : "budget not decided yet"}.`,
  ];
  return { summary: parts.filter(Boolean).join(" ").slice(0, 600) };
}

// ---------------------------------------------------------------------------
// Match explanations: one sentence per factor, only from the score breakdown.
// ---------------------------------------------------------------------------

export function explainMatch(e: Pick<EntrepreneurRecord, "sector" | "business_stage" | "preferred_language" | "expertise_needs" | "budget">, s: ScoredMentor): string {
  const m = s.mentor;
  const b = s.breakdown;
  const parts: string[] = [];

  if (s.matched_expertise.length > 0) {
    parts.push(
      `Covers ${s.matched_expertise.length} of your ${new Set(e.expertise_needs).size} needs: ${listJoin(
        s.matched_expertise.map((x) => expertiseLabel(x).toLowerCase()),
      )}.`,
    );
  } else {
    parts.push("Does not list any of the help you asked for.");
  }
  if (b.sector > 0) parts.push(`Works with ${sectorLabel(e.sector).toLowerCase()} businesses.`);
  if (b.business_stage > 0) parts.push(`Works with ${stageAdj(e.business_stage)} businesses.`);
  if (b.language === 10) parts.push(`Speaks ${LANGUAGE_LABEL[e.preferred_language]}.`);
  else if (b.language > 0) parts.push(`Speaks ${listJoin(m.languages.map((l) => LANGUAGE_LABEL[l]))}, not ${LANGUAGE_LABEL[e.preferred_language]}.`);
  if (b.availability === 10) parts.push(`Has ${m.slots_remaining} open sessions.`);
  else if (b.availability > 0) parts.push("Has 1 open session left.");
  else parts.push("Fully booked right now.");
  if (e.budget <= 0) parts.push(`Fee ${nu(m.fee)} per session.`);
  else if (b.budget === 10) parts.push(`Fee ${nu(m.fee)} is within your budget.`);
  else if (b.budget > 0) parts.push(`Fee ${nu(m.fee)} is a little above your budget.`);
  else parts.push(`Fee ${nu(m.fee)} is well above your budget.`);

  return parts.join(" ");
}

export function fallbackMatchExplanations(e: EntrepreneurRecord, matches: ScoredMentor[]): MatchExplanations {
  return {
    explanations: matches.map((s) => ({ mentor_id: s.mentor.id, explanation: explainMatch(e, s) })),
  };
}

// ---------------------------------------------------------------------------
// Session briefs
// ---------------------------------------------------------------------------

export function fallbackBriefs(e: EntrepreneurRecord, m: MentorRecord, scheduledAt: Date, agenda: AgendaItem[] = []): Briefs {
  const when = scheduledAt.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  if (agenda.length > 0) return followUpBriefs(e, m, when, agenda);
  const needs = e.expertise_needs.map((n) => expertiseLabel(n).toLowerCase());
  const shared = needs.filter((n) => m.expertise.map((x) => expertiseLabel(x).toLowerCase()).includes(n));
  return {
    entrepreneur: {
      headline: `Your session with ${m.full_name} on ${when}`,
      prepare: [
        "Write down three things guests or customers have told you about your business.",
        "Note your current price and roughly what each guest costs you.",
        "Be ready to explain your main challenge in two sentences, with one recent example.",
      ],
      questions_to_ask: [
        shared[0] ? `How would you approach ${shared[0]} for a business like mine?` : `What should I focus on first?`,
        "What is one thing I should test in the next two weeks?",
        "What would you avoid doing at my stage?",
      ],
    },
    mentor: {
      headline: `Session with ${e.full_name}, ${e.business_name ?? "early-stage business"}`,
      about: [
        e.business_name || e.business_stage !== "idea"
          ? `${stageLabel(e.business_stage).replace(" ", "-")} ${sectorWord(e.sector)}business.`
          : `Aspiring entrepreneur at the idea stage${sectorWord(e.sector) ? `, interested in ${sectorWord(e.sector).trim()}` : ""}.`,
        e.business_description ?? "",
        e.primary_challenge ? `Main challenge in their words: "${e.primary_challenge}"` : "",
        `Prefers ${LANGUAGE_LABEL[e.preferred_language]}.`,
      ]
        .filter(Boolean)
        .join(" ")
        .slice(0, 600),
      focus: (shared.length > 0 ? shared : needs).slice(0, 3).map((n) => `Help with ${n}`),
    },
  };
}

/** Brief for a follow-up session: starts from the progress agenda, not from zero. */
function followUpBriefs(e: EntrepreneurRecord, m: MentorRecord, when: string, agenda: AgendaItem[]): Briefs {
  const clip = (s: string) => (s.length > 200 ? `${s.slice(0, 197)}...` : s);
  const open = agenda.filter((a) => a.kind !== "done" && a.kind !== "on_track");
  const titles = [...new Set(agenda.map((a) => a.text.match(/"([^"]+)"/)?.[1]).filter((t): t is string => !!t))];
  return {
    entrepreneur: {
      headline: `Your follow-up session with ${m.full_name} on ${when}`,
      prepare: [
        titles.length ? clip(`Be ready to update ${m.full_name.split(" ")[0]} on: ${titles.join("; ")}.`) : "Be ready to share your progress since the last session.",
        "Bring any notes from guest conversations.",
        "Note one thing that went better than expected.",
      ],
      questions_to_ask: (open.length ? open : agenda).slice(0, 3).map((a) => clip(`What should I do next about ${a.text.match(/"([^"]+)"/)?.[1] ?? "this"}?`)),
    },
    mentor: {
      headline: `Follow-up session with ${e.full_name}, ${e.business_name ?? "early-stage business"}`,
      about: clip(
        `Since your last session: ${agenda.filter((a) => a.kind === "done").length} action(s) done, ${open.length} need attention. The agent has tracked progress between sessions.`,
      ),
      focus: agenda.slice(0, 5).map((a) => clip(a.text)),
    },
  };
}

// ---------------------------------------------------------------------------
// Action extraction
// ---------------------------------------------------------------------------

const normalise = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The saved demo extraction if the notes are the demo notes; otherwise a
 * simple extractor that turns bullet or numbered lines into draft actions.
 * It never invents actions that are not in the notes.
 */
export function fallbackExtraction(notes: string): Extraction {
  if (normalise(notes) === normalise(DEMO_SESSION_NOTES)) return DEMO_EXTRACTED_ACTIONS;
  if (normalise(notes).includes(normalise(DEMO_CALL_TRANSCRIPT))) return DEMO_EXTRACTED_ACTIONS;

  const lines = notes.split("\n").map((l) => l.trim());
  const bullets = lines
    .filter((l) => /^([-*•]|\d+[.)])\s+/.test(l))
    .map((l) => l.replace(/^([-*•]|\d+[.)])\s+/, "").trim())
    .filter((l) => l.length > 0)
    .slice(0, 8);
  // No bullet points (for example a spoken transcript): use the rule-based reader.
  if (bullets.length === 0) return heuristicExtraction(notes);
  const prose = lines.filter((l) => l && !/^([-*•]|\d+[.)])\s+/.test(l) && !/^agreed:?$/i.test(l));
  return {
    summary: (prose.join(" ") || "Session notes recorded.").slice(0, 800),
    actions: bullets.map((title, i) => ({
      title: title.slice(0, 140),
      owner: "entrepreneur" as const,
      due_in_days: 7 + i * 3,
    })),
  };
}

// ---------------------------------------------------------------------------
// Scheduled progress check-in (before the due date)
// ---------------------------------------------------------------------------

export function fallbackCheckIn(e: Pick<EntrepreneurRecord, "full_name">, actionTitle: string, dueAt: Date | null): FollowUp {
  const firstName = e.full_name.split(" ")[0];
  const due = dueAt ? ` It is due on ${dueAt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}.` : "";
  return {
    body: `Kuzu zangpo la, ${firstName}. How is "${actionTitle}" going?${due} Reply with a quick update: on track, done, or stuck.`,
  };
}

// ---------------------------------------------------------------------------
// Overdue follow-up message
// ---------------------------------------------------------------------------

export function fallbackFollowUp(e: Pick<EntrepreneurRecord, "full_name">, actionTitle: string, daysOverdue: number): FollowUp {
  const firstName = e.full_name.split(" ")[0];
  const when = daysOverdue <= 1 ? "was due yesterday" : `was due ${daysOverdue} days ago`;
  return {
    body: `Kuzu zangpo la, ${firstName}. Your action "${actionTitle}" ${when}. What is getting in the way? Reply here and I will find the right help.`,
  };
}
