// Builds a call transcript with CERTAIN speakers: each person's browser
// recorded only its own microphone, so every line's speaker is known.
// Pure (no database, no AI), so it is unit-tested.

import type { TimedSegment } from "../audio/transcribe";

export const CALL_ROLES = ["mentor", "entrepreneur"] as const;
export type CallRole = (typeof CALL_ROLES)[number];

/** One uploaded part of one person's recording. */
export interface TrackPart {
  role: CallRole;
  /** When this part's recording started, in server time (epoch ms). */
  startedAtMs: number;
  segments: TimedSegment[];
}

export interface Turn {
  role: CallRole;
  startMs: number;
  endMs: number;
  text: string;
}

export interface MergedTranscript {
  /** "[Mentor] ...\n[Entrepreneur] ..." */
  text: string;
  turns: Turn[];
  dropped: { silence: number; echo: number };
}

const LABEL: Record<CallRole, string> = { mentor: "Mentor", entrepreneur: "Entrepreneur" };

/** Whisper thinks a piece is silence at or above this: its words are usually invented ("Thank you."). */
const SILENCE_PROB = 0.6;
/** Two pieces this similar, at the same time, from different microphones: one is an echo. */
const ECHO_SIMILARITY = 0.6;
const ECHO_TIME_OVERLAP = 0.5;

interface Piece {
  role: CallRole;
  t0: number;
  t1: number;
  text: string;
  confidence: number;
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 2),
  );
}

/** Share of words in common (0 to 1). */
export function textSimilarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return shared / (wa.size + wb.size - shared);
}

/** How much two time ranges overlap, as a share of the shorter one (0 to 1). */
function timeOverlap(a: Piece, b: Piece): number {
  const shorter = Math.min(a.t1 - a.t0, b.t1 - b.t0);
  if (shorter <= 0) return 0;
  return Math.max(0, Math.min(a.t1, b.t1) - Math.max(a.t0, b.t0)) / shorter;
}

/**
 * Merges both people's timed transcripts into one conversation:
 *   1. drops pieces Whisper itself marks as probably silence;
 *   2. drops echoes (the other person's voice leaking into a microphone shows
 *      up in both recordings at the same time): the clearer copy is kept;
 *   3. orders everything by time and joins consecutive pieces from the same
 *      person into one turn.
 */
export function mergeTracks(parts: TrackPart[]): MergedTranscript {
  const dropped = { silence: 0, echo: 0 };
  let pieces: Piece[] = [];
  for (const p of parts) {
    for (const s of p.segments) {
      const text = s.text.trim();
      if (!text) continue;
      if ((s.no_speech_prob ?? 0) >= SILENCE_PROB) {
        dropped.silence++;
        continue;
      }
      pieces.push({
        role: p.role,
        t0: p.startedAtMs + s.start * 1000,
        t1: p.startedAtMs + Math.max(s.end, s.start) * 1000,
        text,
        confidence: s.avg_logprob ?? -1,
      });
    }
  }
  pieces.sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);

  const echo = new Set<Piece>();
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length && pieces[j].t0 < pieces[i].t1; j++) {
      const a = pieces[i];
      const b = pieces[j];
      if (a.role === b.role || echo.has(a) || echo.has(b)) continue;
      if (timeOverlap(a, b) >= ECHO_TIME_OVERLAP && textSimilarity(a.text, b.text) >= ECHO_SIMILARITY) {
        echo.add(a.confidence >= b.confidence ? b : a);
      }
    }
  }
  dropped.echo = echo.size;
  pieces = pieces.filter((p) => !echo.has(p));

  const turns: Turn[] = [];
  for (const p of pieces) {
    const last = turns.at(-1);
    if (last && last.role === p.role) {
      last.text += ` ${p.text}`;
      last.endMs = Math.max(last.endMs, p.t1);
    } else {
      turns.push({ role: p.role, startMs: p.t0, endMs: p.t1, text: p.text });
    }
  }
  return { text: turns.map((t) => `[${LABEL[t.role]}] ${t.text}`).join("\n"), turns, dropped };
}
