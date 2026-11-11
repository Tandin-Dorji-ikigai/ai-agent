// Keeps AI-written points tied to what people actually said: a point survives
// only if it shares a real word (4+ letters, not a filler word) with the text.

const WORD = /[a-zༀ-࿿]{4,}/gi;
const STOP = new Set(["that", "this", "with", "they", "them", "their", "have", "about", "would", "could", "there", "from", "what", "when", "your", "people", "think", "because", "really", "some"]);

/** Points that share a real word with `text`, at most `max` of them. */
export function groundPoints(points: string[], text: string, max: number): string[] {
  const said = new Set((text.toLowerCase().match(WORD) ?? []).filter((w) => !STOP.has(w)));
  return points.filter((p) => (p.toLowerCase().match(WORD) ?? []).some((w) => !STOP.has(w) && said.has(w))).slice(0, max);
}
