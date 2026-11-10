import { afterEach, describe, expect, it, vi } from "vitest";
import { apiKey, transcribeApiKey, transcribeKeyName } from "./llm";

afterEach(() => vi.unstubAllEnvs());

describe("which Groq key each part uses", () => {
  it("speech-to-text uses its own key when set, and the agent keeps its key", () => {
    vi.stubEnv("GROQ_API_KEY", "agent-key");
    vi.stubEnv("GROQ_TRANSCRIBE_API_KEY", "speech-key");
    expect(apiKey()).toBe("agent-key");
    expect(transcribeApiKey()).toBe("speech-key");
    expect(transcribeKeyName()).toBe("transcription key");
  });

  it("speech-to-text falls back to the agent's key when no separate key is set", () => {
    vi.stubEnv("GROQ_API_KEY", "agent-key");
    vi.stubEnv("GROQ_TRANSCRIBE_API_KEY", "");
    expect(transcribeApiKey()).toBe("agent-key");
    expect(transcribeKeyName()).toBe("agent key");
  });
});
