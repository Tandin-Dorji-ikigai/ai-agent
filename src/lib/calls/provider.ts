import "server-only";

// The video provider behind a call. Default: Daily (daily.co, embeddable
// "Daily Prebuilt" rooms, 10,000 free minutes a month, no participant accounts).
// Rooms are PRIVATE: a link works only with a meeting token, which the server
// gives only to the booking's mentor and entrepreneur.
//
// Without DAILY_API_KEY the provider is "none": no video, but joining,
// consent, recording and transcripts all still work (tests, in-person
// sessions, or a meeting held elsewhere).

export type CallProviderName = "daily" | "none";

export class CallProviderError extends Error {}

const DAILY_API = process.env.DAILY_API_BASE ?? "https://api.daily.co/v1";

export function callProvider(): CallProviderName {
  return process.env.DAILY_API_KEY && process.env.CALL_PROVIDER !== "none" ? "daily" : "none";
}

async function daily(path: string, init: { method: string; body?: unknown }): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${DAILY_API}${path}`, {
    method: init.method,
    headers: { Authorization: `Bearer ${process.env.DAILY_API_KEY}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

const unix = (d: Date) => Math.floor(d.getTime() / 1000);

/** Creates the private room (or finds it if it already exists). Returns its URL. */
export async function createRoom(roomName: string, expiresAt: Date): Promise<string | null> {
  if (callProvider() === "none") return null;
  const created = await daily("/rooms", {
    method: "POST",
    body: {
      name: roomName,
      privacy: "private",
      properties: { exp: unix(expiresAt), eject_at_room_exp: true, max_participants: 2, enable_prejoin_ui: true },
    },
  });
  if (created.status < 300 && typeof created.data.url === "string") return created.data.url;
  // Already created by an earlier join: look it up.
  const existing = await daily(`/rooms/${encodeURIComponent(roomName)}`, { method: "GET" });
  if (existing.status < 300 && typeof existing.data.url === "string") return existing.data.url;
  console.warn(`[calls] Daily room creation failed: HTTP ${created.status} ${String(created.data.info ?? created.data.error ?? "").slice(0, 160)}`);
  throw new CallProviderError("Could not create the video room.");
}

/** A personal link for one participant: the room URL plus a meeting token that expires with the room. */
export async function joinLink(
  roomUrl: string | null,
  roomName: string,
  displayName: string,
  isOwner: boolean,
  expiresAt: Date,
): Promise<string | null> {
  if (callProvider() === "none" || !roomUrl) return null;
  const res = await daily("/meeting-tokens", {
    method: "POST",
    body: { properties: { room_name: roomName, user_name: displayName, is_owner: isOwner, exp: unix(expiresAt) } },
  });
  if (res.status >= 300 || typeof res.data.token !== "string") {
    console.warn(`[calls] Daily meeting token failed: HTTP ${res.status}`);
    throw new CallProviderError("Could not create a link to the video room.");
  }
  return `${roomUrl}?t=${encodeURIComponent(res.data.token)}`;
}

/** Closes the room when the session ends. Best effort: a room also expires on its own. */
export async function deleteRoom(roomName: string): Promise<void> {
  if (callProvider() === "none") return;
  try {
    await daily(`/rooms/${encodeURIComponent(roomName)}`, { method: "DELETE" });
  } catch {
    // The room expires anyway (exp).
  }
}
