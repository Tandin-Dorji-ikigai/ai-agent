"use client";

// Voice notes for mentors (team workflow, Area 1: "Audio (Whisper API)").
// OWNER: the audio-to-text teammate. The server side lives in
// src/app/api/transcribe/route.ts and src/lib/audio/transcribe.ts.

import { useRef, useState } from "react";
import { Badge, Button } from "../ui";

/** Record or upload a voice note; Whisper turns it into text the mentor can edit. */
export function VoiceNote({ available, onText }: { available: boolean; onText: (text: string) => void }) {
  const [phase, setPhase] = useState<"idle" | "recording" | "transcribing">("idle");
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  async function upload(blob: Blob, name: string) {
    setPhase("transcribing");
    setError(null);
    const form = new FormData();
    form.append("file", blob, name);
    try {
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const json = (await res.json()) as { ok: boolean; text?: string; message?: string };
      if (json.ok && json.text) onText(json.text);
      else setError(json.message ?? "Could not transcribe the audio.");
    } catch {
      setError("Cannot reach the app server.");
    } finally {
      setPhase("idle");
    }
  }

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunks.current = [];
      rec.ondataavailable = (e) => chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void upload(new Blob(chunks.current, { type: mime }), mime === "audio/webm" ? "voice-note.webm" : "voice-note.m4a");
      };
      rec.start();
      recorder.current = rec;
      setPhase("recording");
    } catch {
      setError("The microphone is not available. Allow access, or upload an audio file.");
    }
  }

  if (!available) {
    return <p className="text-xs text-muted">Voice notes are available when live AI is switched on.</p>;
  }
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-sm font-medium">Or record a voice note</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {phase === "recording" ? (
          <Button type="button" variant="danger" onClick={() => recorder.current?.stop()}>
            Stop and transcribe
          </Button>
        ) : (
          <Button type="button" variant="secondary" busy={phase === "transcribing"} onClick={start}>
            {phase === "transcribing" ? "Transcribing..." : "Record voice note"}
          </Button>
        )}
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-lg px-3 text-sm font-semibold text-accent hover:bg-accent-soft">
          Upload audio
          <input
            type="file"
            accept="audio/*"
            className="sr-only"
            disabled={phase !== "idle"}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f, f.name);
              e.target.value = "";
            }}
          />
        </label>
        {phase === "recording" && <Badge tone="danger">Recording</Badge>}
      </div>
      <p className="mt-2 text-xs text-muted">The audio is sent to Groq (Whisper) to turn it into text. Check the text before you submit.</p>
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}
