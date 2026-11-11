import { describe, expect, it } from "vitest";
import { transcriptTurns } from "./transcript-turns";

describe("transcriptTurns", () => {
  it("reads labelled lines as turns", () => {
    expect(transcriptTurns("[Mentor] Hello.\n[Entrepreneur] Kuzuzangpo la.\n")).toEqual([
      { speaker: "mentor", text: "Hello." },
      { speaker: "entrepreneur", text: "Kuzuzangpo la." },
    ]);
  });

  it("joins unlabelled lines to the turn before, and keeps leading text", () => {
    expect(transcriptTurns("Call notes\n[Mentor] First line\nsecond line\n\n[Entrepreneur]   \n[Entrepreneur] Yes")).toEqual([
      { speaker: null, text: "Call notes" },
      { speaker: "mentor", text: "First line\nsecond line" },
      { speaker: "entrepreneur", text: "Yes" },
    ]);
  });

  it("returns nothing for an empty transcript", () => {
    expect(transcriptTurns(" \n ")).toEqual([]);
  });
});
