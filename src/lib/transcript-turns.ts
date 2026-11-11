// A stored call transcript ("[Mentor] ...\n[Entrepreneur] ...", see
// src/lib/calls/merge.ts) as chat turns, for showing the whole conversation.
// Lines without a speaker label continue the previous turn (or stand alone).

export interface TranscriptTurn {
  speaker: "mentor" | "entrepreneur" | null;
  text: string;
}

const LABEL = /^\[(Mentor|Entrepreneur)\]\s*/;

export function transcriptTurns(transcript: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const raw of transcript.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const label = LABEL.exec(line);
    if (label) {
      const text = line.slice(label[0].length).trim();
      if (text) turns.push({ speaker: label[1] === "Mentor" ? "mentor" : "entrepreneur", text });
    } else if (turns.length > 0) {
      turns[turns.length - 1].text += `\n${line}`;
    } else {
      turns.push({ speaker: null, text: line });
    }
  }
  return turns;
}
