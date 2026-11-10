"use client";

// Shared voice recorder: record with the microphone (or upload a file), then
// Whisper turns it into text. Used by the entrepreneur's voice intro and the
// mentor's voice note (MentorFlow design, shadcn/ui).

import { useEffect, useRef, useState } from "react";
import { blobToWav16k } from "@/lib/audio/wav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
  /** Text on the record button. */
  recordLabel?: string;
}

/**
 * WAV is about 1.9 MB a minute at 16 kHz. Hosted on Vercel, a request can carry
 * at most 4.5 MB, so only recordings up to 2 minutes are converted; longer ones
 * go in their (much smaller) original format.
 */
const WAV_MAX_SECONDS = 120;
/** Vercel's request limit is 4.5 MB; leave room for the form fields. */
export const MAX_UPLOAD_BYTES = 4.4 * 1024 * 1024;
/** Speech quality: plenty for transcription, about 0.24 MB a minute. */
export const SPEECH_BITS_PER_SECOND = 32_000;

/**
 * Browser recordings (webm/mp4) often fail on Groq; 16 kHz WAV is reliable.
 * Only microphone recordings are converted: uploaded files go as they are.
 * Falls back to the original recording if the browser cannot convert it.
 */
async function asWav(blob: Blob, seconds: number): Promise<{ blob: Blob; name: string } | null> {
  if (seconds > WAV_MAX_SECONDS) return null;
  try {
    return { blob: await blobToWav16k(blob), name: "voice-note.wav" };
  } catch {
    return null;
  }
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
  recordLabel = "Record",
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
    if (blob.size > MAX_UPLOAD_BYTES) {
      setError("That file is too big to upload (over 4 MB). Record instead, or use a shorter clip.");
      setPhase("idle");
      return;
    }
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
      const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: SPEECH_BITS_PER_SECOND });
      const startedAt = Date.now();
      chunks.current = [];
      rec.ondataavailable = (e) => chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const recorded = new Blob(chunks.current, { type: mime });
        const name = mime === "audio/webm" ? "voice-note.webm" : "voice-note.m4a";
        setPhase("transcribing");
        void asWav(recorded, (Date.now() - startedAt) / 1000).then((wav) => upload(wav?.blob ?? recorded, wav?.name ?? name));
      };
      rec.start();
      recorder.current = rec;
      setPhase("recording");
    } catch {
      setError("The microphone is not available. Allow access, or upload an audio file.");
    }
  }

  if (!available) return <p className="muted text-sm">{unavailableText}</p>;

  return (
    <div className="stack-tight rounded-lg border p-4">
      <p className="text-sm font-semibold">{title}</p>
      <div className="row wrap">
        {phase === "recording" ? (
          <Button type="button" variant="destructive" onClick={() => recorder.current?.stop()}>
            Stop and transcribe
          </Button>
        ) : (
          <Button type="button" variant="outline" disabled={phase === "transcribing"} aria-busy={phase === "transcribing" || undefined} onClick={start}>
            {phase === "transcribing" ? "Transcribing…" : recordLabel}
          </Button>
        )}
        <Button type="button" variant="ghost" asChild disabled={phase !== "idle"}>
          <label className="cursor-pointer">
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
        </Button>
        {phase === "recording" && (
          <Badge variant="destructive">
            Recording {mmss(seconds)} / {mmss(maxSeconds)}
          </Badge>
        )}
      </div>
      <p className="muted text-xs">{hint}</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
