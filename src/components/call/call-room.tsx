"use client";

// The real call screen (replaces PR #2's preview). Same layout and controls,
// now with:
//   - live video/audio through LiveKit (a personal pass from /api/calls/join);
//   - consent: nothing is recorded until BOTH people agree;
//   - each browser records ONLY its own microphone, in parts, and uploads
//     them (/api/calls/track), so the transcript's speakers are certain;
//   - Leave uploads the last part and ends the call (/api/calls/end); when both
//     have ended, the agent reads the transcript and drafts actions.
// Without LiveKit settings there is no video, but recording still works
// (people can talk on a phone call or in person).

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, MessageCircle, Mic, MicOff, PhoneOff, ShieldCheck, Video, VideoOff, X } from "lucide-react";
import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack } from "livekit-client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { CallView } from "@/lib/state-types";

type Role = "mentor" | "entrepreneur";

interface JoinInfo {
  call_id: string;
  provider: "livekit" | "daily" | "none";
  livekit: { url: string; token: string } | null;
  server_time_ms: number;
  part_seconds: number;
}

interface ChatMessage {
  id: string;
  mine: boolean;
  body: string;
}

const UPLOAD_TRIES = 3;

async function post<T>(path: string, body: unknown): Promise<{ ok: true } & T | { ok: false; code: string; message: string }> {
  try {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return await res.json();
  } catch {
    return { ok: false, code: "NETWORK", message: "Cannot reach the app server." };
  }
}

function recorderType(): { mimeType: string; ext: string } {
  if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return { mimeType: "audio/webm;codecs=opus", ext: "webm" };
  if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/webm")) return { mimeType: "audio/webm", ext: "webm" };
  return { mimeType: "audio/mp4", ext: "m4a" };
}

export function CallRoom({
  bookingId,
  role,
  open,
  call,
  otherName,
  otherInitials,
  selfInitials,
  onLeft,
  onRefresh,
}: {
  bookingId: string | null;
  role: Role;
  /** A confirmed, upcoming booking exists. */
  open: boolean;
  /** Shared call state (both people's consent), refreshed by polling. */
  call: CallView | null;
  otherName: string;
  otherInitials: string;
  selfInitials: string;
  onLeft: () => void;
  onRefresh: () => void;
}) {
  const otherFirst = otherName.split(" ")[0];
  const [phase, setPhase] = useState<"joining" | "ready" | "error" | "leaving" | "waiting_other">("joining");
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);
  const [connected, setConnected] = useState(false);
  const [remotePresent, setRemotePresent] = useState(false);
  const [remoteVideo, setRemoteVideo] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [consentHidden, setConsentHidden] = useState(false);
  const [recording, setRecording] = useState(false);
  const [pendingUploads, setPendingUploads] = useState(0);
  const [uploadProblem, setUploadProblem] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const roomRef = useRef<Room | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const ownStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const rotateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partRef = useRef(0);
  const uploadsRef = useRef<Promise<void>>(Promise.resolve());
  const offsetRef = useRef(0);
  const leavingRef = useRef(false);
  const remoteVideoEl = useRef<HTMLVideoElement | null>(null);
  const localVideoEl = useRef<HTMLVideoElement | null>(null);
  const audioHost = useRef<HTMLDivElement | null>(null);

  const myConsent = role === "mentor" ? !!call?.consent.mentor : !!call?.consent.entrepreneur;
  const otherConsent = role === "mentor" ? !!call?.consent.entrepreneur : !!call?.consent.mentor;
  const bothAgreed = myConsent && otherConsent;
  const video = info?.provider === "livekit" && connected;

  // ---- Join: personal pass, then connect to the room ----------------------
  useEffect(() => {
    if (!open || !bookingId) return;
    let cancelled = false;
    (async () => {
      const joined = await post<JoinInfo>("/api/calls/join", { booking_id: bookingId, role });
      if (cancelled) return;
      if (!joined.ok) {
        setProblem(joined.message);
        setPhase("error");
        return;
      }
      offsetRef.current = joined.server_time_ms - Date.now();
      setInfo(joined);
      onRefresh();
      if (joined.livekit) {
        const room = new Room({ adaptiveStream: true, dynacast: true });
        const presence = () => setRemotePresent(room.remoteParticipants.size > 0);
        room
          .on(RoomEvent.ParticipantConnected, presence)
          .on(RoomEvent.ParticipantDisconnected, () => {
            presence();
            setRemoteVideo(false);
          })
          .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
            if (track.kind === Track.Kind.Video && remoteVideoEl.current) {
              track.attach(remoteVideoEl.current);
              setRemoteVideo(true);
            } else if (track.kind === Track.Kind.Audio) {
              audioHost.current?.appendChild(track.attach());
            }
          })
          .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
            track.detach().forEach((el) => {
              if (el !== remoteVideoEl.current) el.remove();
            });
            if (track.kind === Track.Kind.Video) setRemoteVideo(false);
          })
          .on(RoomEvent.AudioPlaybackStatusChanged, () => setAudioBlocked(!room.canPlaybackAudio))
          .on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: RemoteParticipant) => {
            try {
              const msg = JSON.parse(new TextDecoder().decode(payload)) as { type: string; body: string };
              if (msg.type === "chat" && participant) setMessages((m) => [...m, { id: crypto.randomUUID(), mine: false, body: msg.body.slice(0, 1000) }]);
            } catch {
              // Not a chat message.
            }
          });
        try {
          await room.connect(joined.livekit.url, joined.livekit.token);
          if (cancelled) {
            void room.disconnect();
            return;
          }
          roomRef.current = room;
          await room.localParticipant.setMicrophoneEnabled(true);
          setConnected(true);
          presence();
        } catch {
          if (!cancelled) setProblem("Could not connect to the video room. You can still record your microphone for the agent's notes.");
        }
      }
      if (!cancelled) setPhase("ready");
    })();
    return () => {
      cancelled = true;
      if (rotateTimer.current) clearTimeout(rotateTimer.current);
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      void roomRef.current?.disconnect();
      roomRef.current = null;
      setConnected(false);
      ownStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [open, bookingId, role, onRefresh]);

  // ---- Recording: own microphone only, in parts ---------------------------
  const upload = useCallback(
    (part: number, startedAtMs: number, blob: Blob, ext: string) => {
      if (!info || blob.size === 0) return;
      setPendingUploads((n) => n + 1);
      uploadsRef.current = uploadsRef.current.then(async () => {
        for (let attempt = 1; attempt <= UPLOAD_TRIES; attempt++) {
          const form = new FormData();
          form.append("call_id", info.call_id);
          form.append("role", role);
          form.append("part", String(part));
          form.append("started_at_ms", String(Math.round(startedAtMs)));
          form.append("file", blob, `${role}-part-${part}.${ext}`);
          try {
            const res = await fetch("/api/calls/track", { method: "POST", body: form });
            const json = (await res.json()) as { ok: boolean; code?: string };
            if (json.ok || json.code === "CALL_ENDED" || json.code === "RECORDING_NOT_ALLOWED") break;
          } catch {
            // Network problem: try again.
          }
          if (attempt === UPLOAD_TRIES) setUploadProblem("Part of the recording could not be uploaded. The mentor can still add notes by hand.");
          else await new Promise((r) => setTimeout(r, attempt * 2000));
        }
        setPendingUploads((n) => n - 1);
      });
    },
    [info, role],
  );

  const micStream = useCallback(async (): Promise<MediaStream> => {
    const lk = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mediaStreamTrack;
    if (lk) return new MediaStream([lk]);
    if (!ownStreamRef.current) {
      ownStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      ownStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = micOn));
    }
    return ownStreamRef.current;
  }, [micOn]);

  const startPart = useCallback(
    (stream: MediaStream, seconds: number) => {
      // One part at a time; every `seconds` the part is closed (and uploaded) and the next begins.
      function begin() {
        const { mimeType, ext } = recorderType();
        const rec = new MediaRecorder(stream, { mimeType });
        const chunks: Blob[] = [];
        const part = partRef.current++;
        const startedAt = Date.now() + offsetRef.current;
        rec.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        rec.onstop = () => upload(part, startedAt, new Blob(chunks, { type: mimeType }), ext);
        rec.start(1000);
        recorderRef.current = rec;
        rotateTimer.current = setTimeout(() => {
          if (leavingRef.current || recorderRef.current !== rec) return;
          rec.stop();
          begin();
        }, seconds * 1000);
      }
      begin();
    },
    [upload],
  );

  useEffect(() => {
    if (phase !== "ready" || !info || !bothAgreed || recorderRef.current || leavingRef.current) return;
    let stopped = false;
    void micStream()
      .then((stream) => {
        if (stopped || leavingRef.current) return;
        micStreamRef.current = stream;
        startPart(stream, info.part_seconds);
        setRecording(true);
      })
      .catch(() => setProblem("The microphone is not available, so this call cannot be recorded. Allow microphone access and rejoin."));
    return () => {
      stopped = true;
    };
  }, [phase, info, bothAgreed, micStream, startPart]);

  function stopRecording(): Promise<void> {
    if (rotateTimer.current) clearTimeout(rotateTimer.current);
    const rec = recorderRef.current;
    recorderRef.current = null;
    setRecording(false);
    if (!rec || rec.state === "inactive") return Promise.resolve();
    return new Promise((resolve) => {
      const done = rec.onstop;
      rec.onstop = (e) => {
        done?.call(rec, e);
        resolve();
      };
      rec.stop();
    });
  }

  // ---- Controls -------------------------------------------------------------
  async function toggleMic() {
    const next = !micOn;
    setMicOn(next);
    if (roomRef.current) await roomRef.current.localParticipant.setMicrophoneEnabled(next);
    ownStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
  }

  async function toggleCamera() {
    const room = roomRef.current;
    if (!room) return;
    const next = !cameraOn;
    try {
      await room.localParticipant.setCameraEnabled(next);
      const track = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
      if (next && track && localVideoEl.current) track.attach(localVideoEl.current);
      setCameraOn(next);
    } catch {
      setProblem("The camera is not available. You can keep talking with audio only.");
    }
  }

  async function agree() {
    if (!info) return;
    const res = await post("/api/calls/consent", { call_id: info.call_id, role, consent: true });
    if (!res.ok) setProblem(res.message);
    onRefresh();
  }

  async function sendChat(e: React.FormEvent) {
    e.preventDefault();
    const body = chatInput.trim();
    if (!body || !roomRef.current) return;
    await roomRef.current.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ type: "chat", body })), { reliable: true });
    setMessages((m) => [...m, { id: crypto.randomUUID(), mine: true, body }]);
    setChatInput("");
  }

  async function leave(force = false) {
    leavingRef.current = true;
    setPhase("leaving");
    await stopRecording();
    await uploadsRef.current;
    let finalized = true;
    if (info) {
      const res = await post<{ finalized: boolean }>("/api/calls/end", { call_id: info.call_id, role, force });
      finalized = res.ok ? res.finalized : true;
      if (!res.ok) setProblem(res.message);
    }
    void roomRef.current?.disconnect();
    roomRef.current = null;
    setConnected(false);
    ownStreamRef.current?.getTracks().forEach((t) => t.stop());
    onRefresh();
    // The mentor may finish for both if the other person has gone; otherwise go back.
    if (!finalized && role === "mentor") setPhase("waiting_other");
    else onLeft();
  }

  // ---- Screen ---------------------------------------------------------------
  const status = !open
    ? "Calls open once a session is booked."
    : phase === "joining"
      ? "Joining the session…"
      : phase === "error"
        ? (problem ?? "Could not join the call.")
        : phase === "leaving"
          ? pendingUploads > 0
            ? "Saving the recording for the agent…"
            : "Ending the call…"
          : phase === "waiting_other"
            ? `You have left. The transcript is built when ${otherFirst} leaves too.`
            : !video
              ? "Video is not set up, so talk by phone or in person. This page can still record your microphone for the agent's notes."
              : remotePresent
                ? `${otherFirst} is here`
                : `Waiting for ${otherFirst} to join…`;

  return (
    <main className="call-room" aria-label="Video session">
      <header className="call-header">
        <div className="row">
          <Button variant="ghost" size="icon" className="call-back" aria-label="Back to sessions" disabled={phase === "leaving"} onClick={() => (phase === "ready" ? leave() : onLeft())}>
            <ArrowLeft className="size-5" />
          </Button>
          <div>
            <p className="call-kicker">MENTORING SESSION</p>
            <h1>Session room</h1>
          </div>
        </div>
        <Badge variant="outline" className="call-preview-badge">
          {video ? "Live" : "Audio for notes"}
        </Badge>
      </header>

      <Card className="call-stage">
        <video ref={remoteVideoEl} className="call-remote-video" autoPlay playsInline hidden={!remoteVideo} aria-label={`${otherFirst}'s video`} />
        <Badge variant="outline" className="participant-role">
          {role === "mentor" ? "Your mentee" : "Your mentor"}
        </Badge>
        {!remoteVideo && (
          <div className="call-participant">
            <Avatar className="call-participant-avatar">
              <AvatarFallback>{otherInitials}</AvatarFallback>
            </Avatar>
            <h2>{otherName}</h2>
            <p role="status">{status}</p>
            {audioBlocked && (
              <Button size="sm" className="mt-4" onClick={() => void roomRef.current?.startAudio()}>
                Tap to hear {otherFirst}
              </Button>
            )}
            {phase === "waiting_other" && (
              <div className="row wrap mt-4">
                <Button size="sm" onClick={() => void leave(true)}>
                  Finish now without waiting
                </Button>
                <Button size="sm" variant="outline" onClick={onLeft}>
                  Back to dashboard
                </Button>
              </div>
            )}
          </div>
        )}
        <Card className="call-self-view">
          <video ref={localVideoEl} className="call-self-video" autoPlay playsInline muted hidden={!cameraOn} aria-label="Your camera" />
          {!cameraOn && (
            <>
              <Avatar className="call-self-avatar">
                <AvatarFallback>{selfInitials}</AvatarFallback>
              </Avatar>
              <span className="self-camera-label">Camera off</span>
            </>
          )}
          <div className="self-view-caption">
            <span>You</span>
            {micOn ? <Mic className="size-3" /> : <MicOff className="size-3" />}
          </div>
        </Card>
        <div className="call-stage-caption" role="status">
          {recording ? <span className="call-recording-dot" aria-hidden /> : <ShieldCheck className="size-3.5" />}
          <span>{recording ? "Recording your microphone for the agent's notes" : bothAgreed ? "Starting the recording…" : "Not recording"}</span>
        </div>

        {phase === "ready" && !myConsent && !consentHidden && !chatOpen && (
          <Card className="call-chat" role="dialog" aria-label="Recording consent">
            <CardHeader>
              <CardTitle>Record this call for the agent&apos;s notes?</CardTitle>
              <CardDescription>
                Both of you must agree. Each person&apos;s microphone is recorded separately and turned into text; the audio is deleted after that. The
                agent drafts the agreed actions, and the mentor checks them.
              </CardDescription>
            </CardHeader>
            <CardContent className="row wrap">
              <Button size="sm" onClick={() => void agree()}>
                I agree
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConsentHidden(true)}>
                Not now
              </Button>
            </CardContent>
          </Card>
        )}
        {phase === "ready" && myConsent && !otherConsent && !chatOpen && (
          <p className="call-consent-note" role="status">
            Waiting for {otherFirst} to agree to recording.
          </p>
        )}
        {(problem || uploadProblem) && phase !== "error" && (
          <p className="call-consent-note" role="alert">
            {uploadProblem ?? problem}
          </p>
        )}

        {chatOpen && (
          <Card className="call-chat">
            <CardHeader>
              <div className="row between">
                <CardTitle>Session chat</CardTitle>
                <Button variant="ghost" size="icon" aria-label="Close chat" onClick={() => setChatOpen(false)}>
                  <X className="size-4" />
                </Button>
              </div>
              <CardDescription>{video ? "Messages go only to the two of you and are not saved." : "Chat needs video to be set up."}</CardDescription>
            </CardHeader>
            <CardContent className="stack">
              <div className="max-h-48 overflow-y-auto space-y-3" role="log" aria-label="Session messages">
                {messages.map((m) => (
                  <p key={m.id} className="break-words">
                    <strong>{m.mine ? "You" : otherFirst}: </strong>
                    {m.body}
                  </p>
                ))}
              </div>
              <form className="row" onSubmit={(e) => void sendChat(e)}>
                <Input value={chatInput} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setChatInput(e.target.value)} maxLength={1000} placeholder="Write a message…" aria-label="Chat message" disabled={!video} />
                <Button type="submit" size="icon" disabled={!video || !chatInput.trim()} aria-label="Send message">
                  <ArrowRight className="size-4" />
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
        <div ref={audioHost} hidden />
      </Card>

      <footer className="call-footer">
        <div className="call-controls">
          <div className="call-action">
            <Button
              variant="secondary"
              size="icon"
              disabled={phase !== "ready"}
              className={`call-control ${micOn ? "" : "control-muted"}`}
              aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
              aria-pressed={!micOn}
              onClick={() => void toggleMic()}
            >
              {micOn ? <Mic className="size-5" /> : <MicOff className="size-5" />}
            </Button>
            <span>{micOn ? "Mute" : "Unmute"}</span>
          </div>
          <div className="call-action">
            <Button
              variant="secondary"
              size="icon"
              disabled={phase !== "ready" || !video}
              className={`call-control ${cameraOn ? "" : "control-muted"}`}
              aria-label={cameraOn ? "Turn camera off" : "Turn camera on"}
              aria-pressed={cameraOn}
              onClick={() => void toggleCamera()}
            >
              {cameraOn ? <Video className="size-5" /> : <VideoOff className="size-5" />}
            </Button>
            <span>Camera</span>
          </div>
          <div className="call-action">
            <Button
              variant="secondary"
              size="icon"
              className={`call-control ${chatOpen ? "control-selected" : ""}`}
              aria-label="Session chat"
              aria-expanded={chatOpen}
              onClick={() => setChatOpen((o) => !o)}
            >
              <MessageCircle className="size-5" />
            </Button>
            <span>Chat</span>
          </div>
          <div className="call-action">
            <Button
              variant="destructive"
              size="icon"
              className="call-control call-leave"
              aria-label="Leave the session"
              disabled={phase === "leaving" || phase === "joining"}
              onClick={() => (phase === "ready" ? void leave() : onLeft())}
            >
              <PhoneOff className="size-5" />
            </Button>
            <span>Leave</span>
          </div>
        </div>
        <p className="call-preview-note">
          {video ? "Audio-only works too: keep your camera off on a weak connection." : "No video in this session."} Recording only when both agree.
        </p>
      </footer>
    </main>
  );
}
