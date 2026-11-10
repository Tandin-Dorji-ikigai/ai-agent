// Sign-in for a hosted test deployment: one password per ROLE, not user
// accounts. Whoever types the mentor password is "the mentor" on that device,
// and the server (not the page) decides what that device may do.
//
//   ENTREPRENEUR_PASSWORD  the entrepreneur (Pema) screens and actions
//   MENTOR_PASSWORD        the mentor workspace, accepting requests, notes
//   YDF_PASSWORD           the YDF staff page and the demo controls
//   DEMO_PASSWORD          the team: everything, for building and presenting
//
// Everyone signs in on the same page (/login); the password alone decides the
// role and where they land. Use four different passwords.
//
// With none of them set (local development) there is no sign-in at all.
// Works in the proxy and in route handlers (Web Crypto only, no Node APIs).

export const VIEWER_ROLES = ["entrepreneur", "mentor", "ydf", "team"] as const;
export type ViewerRole = (typeof VIEWER_ROLES)[number];

export const ROLE_PASSWORD_ENV: Record<ViewerRole, string> = {
  entrepreneur: "ENTREPRENEUR_PASSWORD",
  mentor: "MENTOR_PASSWORD",
  ydf: "YDF_PASSWORD",
  team: "DEMO_PASSWORD",
};

export const ROLE_LABEL: Record<ViewerRole, string> = {
  entrepreneur: "the entrepreneur",
  mentor: "the mentor",
  ydf: "YDF staff",
  team: "the team",
};

export const ACCESS_COOKIE = "mentorflow_access";
export const ACCESS_DAYS = 30;

export type RolePasswords = Partial<Record<ViewerRole, string>>;

/** The role passwords that are set (empty values count as not set). */
export function rolePasswords(env: Record<string, string | undefined> = process.env): RolePasswords {
  const out: RolePasswords = {};
  for (const role of VIEWER_ROLES) {
    const value = env[ROLE_PASSWORD_ENV[role]];
    if (value) out[role] = value;
  }
  return out;
}

/** Sign-in is on as soon as any role password is set. */
export function gateOn(passwords: RolePasswords): boolean {
  return Object.keys(passwords).length > 0;
}

/** A keyed hash of the password, bound to its role. Never the password itself. */
export async function accessToken(role: ViewerRole, password: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`mentorflow-access-v2:${role}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** What the cookie holds: "<role>.<keyed hash>". Changing a password signs that role out everywhere. */
export async function accessCookieValue(role: ViewerRole, password: string): Promise<string> {
  return `${role}.${await accessToken(role, password)}`;
}

/** The role a cookie proves, or null (missing, forged, or that role's password changed). */
export async function roleFromCookie(value: string | undefined, passwords: RolePasswords): Promise<ViewerRole | null> {
  if (!value) return null;
  const dot = value.indexOf(".");
  const role = value.slice(0, dot) as ViewerRole;
  if (dot < 1 || !VIEWER_ROLES.includes(role)) return null;
  const password = passwords[role];
  if (!password) return null;
  return sameText(value.slice(dot + 1), await accessToken(role, password)) ? role : null;
}

/**
 * Which role a typed password belongs to. If two roles were given the same
 * password by mistake, the one with the fewest rights wins (the order of VIEWER_ROLES).
 */
export async function roleForPassword(given: string, passwords: RolePasswords): Promise<ViewerRole | null> {
  let found: ViewerRole | null = null;
  for (const role of VIEWER_ROLES) {
    const password = passwords[role];
    if (!password) continue;
    // Compare keyed hashes (same length) and check every role, so timing says nothing.
    const match = sameText(await accessToken(role, given), await accessToken(role, password));
    if (match && !found) found = role;
  }
  return found;
}

/** Compares without leaking where two strings first differ. */
export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Who may open what. The team (DEMO_PASSWORD) may open everything.
// ---------------------------------------------------------------------------

/** The one sign-in page, for every role. */
export const SIGN_IN_PATH = "/login";
/** Earlier sign-in addresses: the proxy forwards them to /login so old links keep working. */
export const OLD_SIGN_IN_PATHS = ["/access", "/entrepreneur/login", "/mentor/login"] as const;
/** Pages anyone may open without signing in. */
export const SIGN_IN_PAGES = [SIGN_IN_PATH, ...OLD_SIGN_IN_PATHS] as const;

type Rule = "public" | "any" | readonly ViewerRole[];

const ENTREPRENEUR = ["entrepreneur"] as const;
const MENTOR = ["mentor"] as const;
const BOTH = ["entrepreneur", "mentor"] as const;
const YDF = ["ydf"] as const;
const TEAM_ONLY = [] as const;

/** Every API route and who may call it. A route missing here is team-only (a test checks none is missing). */
export const API_RULES: Record<string, Rule> = {
  "/api/access": "public",
  "/api/state": "any",
  // Entrepreneur
  "/api/assessment": ENTREPRENEUR,
  "/api/assessment/draft": ENTREPRENEUR,
  "/api/matches": ENTREPRENEUR,
  "/api/requests/start": ENTREPRENEUR,
  "/api/requests/ask": ENTREPRENEUR,
  "/api/inbox/reply": ENTREPRENEUR,
  "/api/actions/status": ENTREPRENEUR,
  "/api/coach/start": ENTREPRENEUR,
  "/api/coach/reply": ENTREPRENEUR,
  "/api/coach/skip": ENTREPRENEUR,
  // Mentor
  "/api/requests/accept": MENTOR,
  "/api/requests/decline": MENTOR,
  "/api/mentors/availability": MENTOR,
  "/api/session/complete": MENTOR,
  "/api/actions/confirm": MENTOR,
  // Both sides of a call (each route also checks the side matches the sign-in)
  "/api/calls/join": BOTH,
  "/api/calls/consent": BOTH,
  "/api/calls/track": BOTH,
  "/api/calls/end": BOTH,
  "/api/transcribe": BOTH,
  // Call notifications on this device (subscribe checks the side matches the sign-in)
  "/api/push/subscribe": BOTH,
  "/api/push/unsubscribe": BOTH,
  "/api/push/test": BOTH,
  // YDF staff: the demo controls and agent retries
  "/api/demo/reset": YDF,
  "/api/demo/fast-forward": YDF,
  "/api/demo/fixtures": YDF,
  "/api/agent/run": YDF,
  // Developer tools
  "/api/dev/extract": TEAM_ONLY,
};

function under(pathname: string, area: string): boolean {
  return pathname === area || pathname.startsWith(`${area}/`);
}

export function ruleFor(pathname: string): Rule {
  if ((SIGN_IN_PAGES as readonly string[]).includes(pathname)) return "public";
  if (pathname.startsWith("/api/")) return API_RULES[pathname] ?? TEAM_ONLY;
  if (under(pathname, "/entrepreneur")) return ENTREPRENEUR;
  if (under(pathname, "/mentor")) return MENTOR;
  if (under(pathname, "/ydf")) return YDF;
  return "any"; // the welcome and get-started pages
}

export function mayOpen(role: ViewerRole | null, pathname: string): boolean {
  const rule = ruleFor(pathname);
  if (rule === "public") return true;
  if (!role) return false;
  return role === "team" || rule === "any" || rule.includes(role);
}

/** Where a role starts after signing in. */
export function homeFor(role: ViewerRole): string {
  return { entrepreneur: "/entrepreneur/connect", mentor: "/mentor/dashboard", ydf: "/ydf", team: "/" }[role];
}

/** Only same-site paths, so the sign-in page cannot be used to send people elsewhere. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if ((SIGN_IN_PAGES as readonly string[]).includes(next.split(/[?#]/)[0])) return "/";
  return next;
}

/** After signing in: the page they asked for if this role may open it, else the role's start page. */
export function nextAfterSignIn(role: ViewerRole | null, next: string | null | undefined): string {
  const target = safeNext(next);
  if (!role) return target; // sign-in is off
  if (target === "/" && role !== "team") return homeFor(role);
  return mayOpen(role, target.split(/[?#]/)[0]) ? target : homeFor(role);
}
