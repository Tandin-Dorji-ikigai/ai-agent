import "server-only";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

// The video provider behind a call: LiveKit Cloud (free "Build" plan, no card,
// 5,000 minutes a month). The browser connects with livekit-client using a
// short-lived pass (token) that the server signs only for the booking's mentor
// or entrepreneur, for that one room.
//
// Without LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET the provider is
// "none": no video, but joining, consent, recording and transcripts all still
// work (tests, in-person sessions, or people talking on a phone call).

export type CallProviderName = "livekit" | "none";

export class CallProviderError extends Error {}

export function callProvider(): CallProviderName {
  return process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET && process.env.CALL_PROVIDER !== "none"
    ? "livekit"
    : "none";
}

/** The browser connects to this (wss://...). */
export function livekitUrl(): string {
  return process.env.LIVEKIT_URL ?? "";
}

/** The server API uses the same host over https. */
function rooms(): RoomServiceClient {
  const host = livekitUrl().replace(/^wss:\/\//, "https://").replace(/^ws:\/\//, "http://");
  return new RoomServiceClient(host, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
}

/**
 * Creates the room up front so it allows only the two participants and closes
 * soon after both leave. Returns the URL the browser connects to.
 */
export async function createRoom(roomName: string): Promise<string | null> {
  if (callProvider() === "none") return null;
  try {
    await rooms().createRoom({ name: roomName, maxParticipants: 2, emptyTimeout: 10 * 60, departureTimeout: 120 });
  } catch (err) {
    console.warn("[calls] LiveKit room creation failed:", err instanceof Error ? err.message.slice(0, 160) : "error");
    throw new CallProviderError("Could not create the video room.");
  }
  return livekitUrl();
}

/** A personal pass for one participant: this room only, expires after `seconds`. */
export async function joinToken(roomName: string, identity: string, displayName: string, seconds: number): Promise<string | null> {
  if (callProvider() === "none") return null;
  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity, name: displayName, ttl: seconds });
  at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: true });
  return at.toJwt();
}

/** Closes the room when the session ends. Best effort: an empty room also closes by itself. */
export async function deleteRoom(roomName: string): Promise<void> {
  if (callProvider() === "none") return;
  try {
    await rooms().deleteRoom(roomName);
  } catch {
    // Already gone, or it will close when empty.
  }
}
