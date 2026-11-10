// The shared demo password (for a hosted test deployment). Not user accounts:
// everyone types the same password once per device; it keeps strangers from
// resetting the demo, using the AI and call quotas, or joining calls.
// With DEMO_PASSWORD unset (local development) there is no gate.
// Works in the proxy and in route handlers (Web Crypto only).

export const ACCESS_COOKIE = "mentorflow_access";
export const ACCESS_DAYS = 30;

/** What the cookie holds: a keyed hash of the password, never the password itself. */
export async function accessToken(password: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("mentorflow-demo-access-v1"));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares without leaking where two strings first differ. */
export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Only same-site paths, so the sign-in page cannot be used to send people elsewhere. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.startsWith("/access")) return "/";
  return next;
}
