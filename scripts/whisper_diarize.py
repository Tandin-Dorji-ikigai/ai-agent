#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Local mentoring-call transcription with speaker diarization.

Port of the Colab whisper_model notebook for offline / high-accuracy use.
The Next.js app uses Groq Whisper + LLM role labels by default; this script
uses pyannote for acoustic diarization (true two-speaker timeline), then
transcribes each turn with Groq Whisper and maps speakers to Mentor /
Entrepreneur.

Requirements (see scripts/requirements-whisper.txt):
  pip install -r scripts/requirements-whisper.txt
  ffmpeg on PATH
  GROQ_API_KEY and HF_TOKEN in the environment (never hard-code keys)

Accept the pyannote/speaker-diarization-3.1 model terms on Hugging Face first.

Usage:
  python scripts/whisper_diarize.py path/to/call.mp4
  python scripts/whisper_diarize.py path/to/call.wav --mentor-first
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROLE_MENTOR = "Mentor"
ROLE_ENTREPRENEUR = "Entrepreneur"


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        print(f"Missing {name}. Set it in the environment or .env.local (do not commit keys).", file=sys.stderr)
        sys.exit(1)
    return value


def to_wav_mono_16k(src: Path, dest: Path) -> None:
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(src),
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        str(dest),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def diarize_and_transcribe(media: Path, mentor_is_speaker_00: bool) -> list[str]:
    import torch
    from groq import Groq
    from pydub import AudioSegment
    from pyannote.audio import Pipeline

    groq_key = require_env("GROQ_API_KEY")
    hf_token = require_env("HF_TOKEN")
    client = Groq(api_key=groq_key)

    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "audio.wav"
        print(f"Converting to wav mono 16k: {media.name}")
        to_wav_mono_16k(media, wav)

        print("Loading pyannote speaker-diarization-3.1 …")
        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            token=hf_token,
        )
        if torch.cuda.is_available():
            pipeline.to(torch.device("cuda"))

        # Mentoring calls: force two speakers (Mentor + Entrepreneur).
        output = pipeline(str(wav), num_speakers=2)
        diarization = getattr(output, "speaker_diarization", output)

        audio = AudioSegment.from_wav(str(wav))
        speaker_map: dict[str, str] = {}
        # First acoustic cluster -> Mentor by default; swap with --entrepreneur-first.
        role_order = (
            [ROLE_MENTOR, ROLE_ENTREPRENEUR]
            if mentor_is_speaker_00
            else [ROLE_ENTREPRENEUR, ROLE_MENTOR]
        )

        lines: list[str] = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            start_ms = int(turn.start * 1000)
            end_ms = int(turn.end * 1000)
            if end_ms - start_ms < 400:
                continue

            if speaker not in speaker_map:
                speaker_map[speaker] = role_order[len(speaker_map) % 2]

            clip = audio[start_ms:end_ms]
            clip_path = Path(tmp) / f"turn_{start_ms}_{end_ms}.wav"
            clip.export(str(clip_path), format="wav")

            with open(clip_path, "rb") as f:
                text = client.audio.transcriptions.create(
                    file=f,
                    model=os.environ.get("AI_MODEL_TRANSCRIBE", "whisper-large-v3-turbo"),
                ).text.strip()

            if text:
                line = f"[{speaker_map[speaker]}] {text}"
                lines.append(line)
                print(line)

        return lines


def main() -> None:
    parser = argparse.ArgumentParser(description="Diarize + transcribe a mentoring call.")
    parser.add_argument("media", type=Path, help="Audio or video file (.mp4, .wav, .mp3, …)")
    parser.add_argument(
        "--entrepreneur-first",
        action="store_true",
        help="Map the first detected speaker cluster to Entrepreneur (default: Mentor).",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Write the labeled transcript to this file (UTF-8).",
    )
    args = parser.parse_args()

    if not args.media.is_file():
        print(f"File not found: {args.media}", file=sys.stderr)
        sys.exit(1)

    lines = diarize_and_transcribe(args.media, mentor_is_speaker_00=not args.entrepreneur_first)
    final = "\n".join(lines) if lines else "No clear speech segments found."
    print("\n===== FINAL =====")
    print(final)

    if args.output:
        args.output.write_text(final + "\n", encoding="utf-8")
        print(f"\nWrote {args.output}")


if __name__ == "__main__":
    main()
