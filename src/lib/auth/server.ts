import "server-only";
import { createClient, type Session, type User } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { db, ConfigError } from "../supabase/server";
import { loadEntrepreneur } from "../data";
import type { EntrepreneurAccount } from "./types";
import { ACCESS_COOKIE as ROLE_ACCESS_COOKIE } from "../access";
import { ACCOUNT_ACCESS_COOKIE, ACCOUNT_REFRESH_COOKIE, ACCOUNT_REMEMBER_COOKIE } from "./cookie-names";

export const ACCESS_COOKIE = ACCOUNT_ACCESS_COOKIE;
export const REFRESH_COOKIE = ACCOUNT_REFRESH_COOKIE;
export const REMEMBER_COOKIE = ACCOUNT_REMEMBER_COOKIE;

export class AccountError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

// Never sign in on the cached service-role database client: Auth mutates the
// client's authorization state. A fresh client is isolated to this request.
export function authClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new ConfigError("Set the server-side Supabase URL and key in .env.local before registering accounts.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export function assertSameOrigin(req: NextRequest) {
  const expected = new URL(process.env.APP_ORIGIN || req.url).origin;
  const origin = req.headers.get("origin");
  if ((origin && origin !== expected) || req.headers.get("sec-fetch-site") === "cross-site") {
    throw new AccountError(403, "INVALID_ORIGIN", "Open the app directly before submitting this form.");
  }
}

export function authResponse(body: object, status = 200) {
  const response = NextResponse.json({ ok: true, ...body }, { status });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

function cookieOptions(req: NextRequest) {
  return { httpOnly: true, secure: new URL(process.env.APP_ORIGIN || req.url).protocol === "https:", sameSite: "lax" as const, path: "/" };
}
export function setSessionCookies(req: NextRequest, response: NextResponse, session: Session, remember: boolean) {
  const options = cookieOptions(req);
  // Switching to a personal account must not retain a demo mentor/team role.
  response.cookies.set(ROLE_ACCESS_COOKIE, "", { ...options, maxAge: 0 });
  response.cookies.set(ACCESS_COOKIE, session.access_token, { ...options, maxAge: session.expires_in });
  // Without "remember me", the refresh cookie is a browser-session cookie.
  response.cookies.set(REFRESH_COOKIE, session.refresh_token, { ...options, ...(remember ? { maxAge: 30 * 86400 } : {}) });
  response.cookies.set(REMEMBER_COOKIE, remember ? "1" : "0", { ...options, ...(remember ? { maxAge: 30 * 86400 } : {}) });
}
export function clearSessionCookies(req: NextRequest, response: NextResponse) {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, REMEMBER_COOKIE]) response.cookies.set(name, "", { ...cookieOptions(req), maxAge: 0 });
}

export async function registeredAccount(user: User): Promise<EntrepreneurAccount> {
  const { data: profile, error } = await db().from("profiles").select("id, role, phone").eq("auth_user_id", user.id).maybeSingle();
  if (error) throw new AccountError(503, "REGISTRATION_NOT_READY", "Account storage is unavailable. Ask the project owner to apply the registration migration.");
  if (!profile || profile.role !== "entrepreneur") throw new AccountError(403, "ENTREPRENEUR_ACCOUNT_REQUIRED", "This sign-in is for registered entrepreneurs and mentees.");
  const [entrepreneur, onboarding] = await Promise.all([
    loadEntrepreneur(profile.id),
    db().from("entrepreneur_profiles").select("onboarding_path, onboarding_details").eq("user_id", profile.id).single(),
  ]);
  if (!entrepreneur || onboarding.error) throw new AccountError(503, "PROFILE_UNAVAILABLE", "Your account profile could not be loaded. Please try again.");
  return { id: user.id, email: user.email ?? "", entrepreneur, phone: profile.phone, path: onboarding.data.onboarding_path, details: onboarding.data.onboarding_details ?? {} };
}

export async function readIdentity(req: NextRequest) {
  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  if (!access && !refresh) return { user: null, session: null };
  const client = authClient();
  if (access) {
    const { data, error } = await client.auth.getUser(access);
    if (!error && data.user) return { user: data.user, session: null };
    // Refresh only expired/invalid sessions, not transient provider outages.
    if (error && (error.name === "AuthRetryableFetchError" || !error.status || error.status >= 500)) throw new AccountError(503, "AUTH_UNAVAILABLE", "Sign-in is temporarily unavailable. Please try again.");
  }
  if (refresh) {
    const { data, error } = await client.auth.refreshSession({ refresh_token: refresh });
    if (!error && data.user && data.session) return { user: data.user, session: data.session };
    if (error && (error.name === "AuthRetryableFetchError" || !error.status || error.status >= 500)) throw new AccountError(503, "AUTH_UNAVAILABLE", "Sign-in is temporarily unavailable. Please try again.");
  }
  return { user: null, session: null };
}

export function providerError(error: { code?: string; status?: number }): never {
  if (error.code === "email_not_confirmed") throw new AccountError(403, "EMAIL_NOT_CONFIRMED", "Confirm your email before signing in. You can request a new confirmation email below.");
  if (error.status === 429 || error.code?.includes("rate_limit")) throw new AccountError(429, "AUTH_RATE_LIMIT", "Too many attempts. Please wait before trying again.");
  if (error.code === "weak_password") throw new AccountError(400, "WEAK_PASSWORD", "Choose a stronger password with at least 8 characters.");
  if (error.code === "invalid_credentials") throw new AccountError(401, "INVALID_CREDENTIALS", "The email or password is incorrect.");
  if (error.code === "signup_disabled") throw new AccountError(503, "SIGNUP_DISABLED", "Registration is currently disabled. Contact the programme team.");
  throw new AccountError(503, "AUTH_UNAVAILABLE", "The account request could not be completed. Please try again or contact the programme team.");
}

export function authFailure(error: unknown) {
  const known = error instanceof AccountError || error instanceof ConfigError;
  const response = NextResponse.json({ ok: false, code: known ? error.code : "AUTH_UNAVAILABLE", message: known ? error.message : "The account request could not be completed. Please try again." }, { status: error instanceof AccountError ? error.status : 503 });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
