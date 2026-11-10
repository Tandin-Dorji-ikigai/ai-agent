"use client";

// Shared voice recorder: record with the microphone (or upload a file), then
// Whisper turns it into text. Used by the mentor's voice notes and the
// entrepreneur's voice intro. OWNER: the audio-to-text teammate.

import { useEffect, useRef, useState } from "react";
import { Badge, Button } from "../ui";

export interface VoiceRecorderProps {
  /** Live AI must be on (transcription needs it). */
  available: boolean;
  onText: (text: string) => void;
  title: string;
  hint: string;
  /** Ask Whisper for this language (English for now). */
  language?: "en";
  /** Stop automatically after this many seconds. */
  maxSeconds?: number;
  unavailableText?: string;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function VoiceRecorder({
  available,
  onText,
  title,
  hint,
  language,
  maxSeconds = 300,
  unavailableText = "Voice input is available when live AI is switched on.",
}: VoiceRecorderProps) {
  const [phase, setPhase] = useState<"idle" | "recording" | "transcribing">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  // Recording timer, with an automatic stop at maxSeconds.
  useEffect(() => {
    if (phase !== "recording") return;
    const started = Date.now();
    const id = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      setSeconds(s);
      if (s >= maxSeconds) recorder.current?.stop();
    }, 250);
    return () => clearInterval(id);
  }, [phase, maxSeconds]);

  async function upload(blob: Blob, name: string) {
    setPhase("transcribing");
    setError(null);
    const form = new FormData();
    form.append("file", blob, name);
    if (language) form.append("language", language);
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
    setSeconds(0);
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

  if (!available) return <p className="text-xs text-muted">{unavailableText}</p>;

  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-sm font-medium">{title}</p>
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
        {phase === "recording" && (
          <Badge tone="danger">
            Recording {mmss(seconds)} / {mmss(maxSeconds)}
          </Badge>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">{hint}</p>
      {error && (
        <p role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
