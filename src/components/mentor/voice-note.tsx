"use client";

// Voice notes for mentors (team workflow, Area 1: "Audio (Whisper API)").
// OWNER: the audio-to-text teammate. Built on the shared VoiceRecorder.

import { VoiceRecorder } from "../voice/voice-recorder";

/** Record or upload a voice note; Whisper turns it into text the mentor can edit. */
export function VoiceNote({ available, onText }: { available: boolean; onText: (text: string) => void }) {
  return (
    <VoiceRecorder
      available={available}
      onText={onText}
      title="Or record a voice note"
      hint="The audio is sent to Groq (Whisper) to turn it into text. Check the text before you submit."
      language="en"
      maxSeconds={600}
      unavailableText="Voice notes are available when live AI is switched on."
    />
  );
}
