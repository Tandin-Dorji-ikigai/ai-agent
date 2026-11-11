import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./handlers";
import { registrationFromForm, registrationDefaults } from "./registration-form";
import { PEMA_ASSESSMENT_ANSWERS } from "../demo/fixtures";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(), signUp: vi.fn(), signInWithPassword: vi.fn(), getUser: vi.fn(), refreshSession: vi.fn(),
  resend: vi.fn(), signOut: vi.fn(), adminSignOut: vi.fn(), rpc: vi.fn(), from: vi.fn(),
  maybeSingle: vi.fn(), single: vi.fn(), eq: vi.fn(), loadEntrepreneur: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/server", () => ({
  ConfigError: class ConfigError extends Error { code = "SUPABASE_NOT_CONFIGURED"; },
  db: () => ({ rpc: mocks.rpc, from: mocks.from, auth: { admin: { signOut: mocks.adminSignOut } } }),
}));
vi.mock("@/lib/data", () => ({ loadEntrepreneur: mocks.loadEntrepreneur }));

const user = { id: "10000000-0000-4000-8000-000000000001", email: "new@example.com" };
const session = { access_token: "test-access-token", refresh_token: "test-refresh-token", expires_in: 3600, user };
const input = registrationFromForm({ ...registrationDefaults(), fullName: "New Mentee", email: user.email, password: "valid-test-password", confirmPassword: "valid-test-password", district: "Paro", productName: "New project", industry: "Tourism & Hospitality", description: "A walking tour", challenge: "Finding customers", goal: "Get feedback" }, ["pricing"], false);
function context(action: string) { return { params: Promise.resolve({ action }) }; }
function request(action: string, body: unknown = {}, headers: Record<string, string> = {}) {
  return new NextRequest(`https://app.example/api/auth/${action}`, { method: "POST", headers: { "content-type": "application/json", origin: "https://app.example", ...headers }, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SUPABASE_URL", "https://test-project.supabase.co");
  vi.stubEnv("SUPABASE_ANON_KEY", "test-public-key");
  vi.stubEnv("APP_ORIGIN", "https://app.example");
  mocks.createClient.mockReturnValue({ auth: { signUp: mocks.signUp, signInWithPassword: mocks.signInWithPassword, getUser: mocks.getUser, refreshSession: mocks.refreshSession, resend: mocks.resend, signOut: mocks.signOut } });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.signUp.mockResolvedValue({ data: { user, session: null }, error: null });
  mocks.signInWithPassword.mockResolvedValue({ data: { user, session }, error: null });
  mocks.getUser.mockResolvedValue({ data: { user }, error: null });
  mocks.adminSignOut.mockResolvedValue({ error: null });
  const builder = { select: vi.fn(), eq: mocks.eq, maybeSingle: mocks.maybeSingle, single: mocks.single };
  builder.select.mockReturnValue(builder); mocks.eq.mockReturnValue(builder); mocks.from.mockReturnValue(builder);
  mocks.maybeSingle.mockResolvedValue({ data: { id: user.id, role: "entrepreneur", phone: null }, error: null });
  mocks.single.mockResolvedValue({ data: { onboarding_path: "idea", onboarding_details: { mode: "Online only" } }, error: null });
  mocks.loadEntrepreneur.mockResolvedValue({ ...PEMA_ASSESSMENT_ANSWERS, id: user.id, full_name: "New Mentee", location: "Paro", assessment_summary: null, assessment_completed_at: null });
});

describe("entrepreneur auth endpoints", () => {
  it("signs up through Auth without storing a password in profile metadata or returning tokens", async () => {
    const response = await POST(request("signup", input), context("signup"));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, signed_in: false, requires_email_confirmation: true });
    const sent = mocks.signUp.mock.calls[0][0];
    expect(sent.password).toBe(input.password);
    expect(sent.options.data.mentorflow_registration).not.toHaveProperty("password");
    expect(sent.options.data.mentorflow_registration).not.toHaveProperty("email");
    expect(sent.options.emailRedirectTo).toBe("https://app.example/account/login");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it("never creates an Auth account if the profile migration has not been applied", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "not found" } });
    const response = await POST(request("signup", input), context("signup"));
    expect(response.status).toBe(503); expect(mocks.signUp).not.toHaveBeenCalled();
  });
  it("supports the teammate's server-only Supabase secret-key alias", async () => {
    vi.stubEnv("SUPABASE_ANON_KEY", ""); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", ""); vi.stubEnv("SUPABASE_SECRET_KEY", "test-server-secret");
    const response = await POST(request("signup", input), context("signup"));
    expect(response.status).toBe(201);
    expect(mocks.createClient).toHaveBeenCalledWith("https://test-project.supabase.co", "test-server-secret", expect.any(Object));
    expect(JSON.stringify(await response.json())).not.toContain("test-server-secret");
  });
  it("rejects invalid input and cross-site requests before contacting Supabase", async () => {
    expect((await POST(request("signup", { ...input, role: "mentor" }), context("signup"))).status).toBe(400);
    expect((await POST(request("signin", {}, { origin: "https://evil.example" }), context("signin"))).status).toBe(403);
    expect((await POST(request("signin", {}, { "sec-fetch-site": "cross-site" }), context("signin"))).status).toBe(403);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("handles invalid JSON and oversized submissions", async () => {
    const malformed = new NextRequest("https://app.example/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    expect((await POST(malformed, context("signup"))).status).toBe(400);
    expect((await POST(request("signup", { text: "x".repeat(33000) }), context("signup"))).status).toBe(413);
  });
  it("starts an HttpOnly secure session when signup confirmation is disabled", async () => {
    mocks.signUp.mockResolvedValue({ data: { user, session }, error: null });
    const response = await POST(request("signup", input), context("signup"));
    expect(response.cookies.get("mentorflow-access")!.value).toBe(session.access_token);
    expect(response.cookies.get("mentorflow-refresh")!.httpOnly).toBe(true);
    expect(response.cookies.get("mentorflow-refresh")!.secure).toBe(true);
    expect(response.cookies.get("mentorflow-refresh")!.sameSite).toBe("lax");
    expect(response.cookies.get("mentorflow_access")!.maxAge).toBe(0);
    expect(JSON.stringify(await response.json())).not.toContain("token");
  });
  it("keeps duplicate signup responses generic", async () => {
    mocks.signUp.mockResolvedValue({ data: { user: null, session: null }, error: { code: "user_already_exists" } });
    const response = await POST(request("signup", input), context("signup"));
    expect(response.status).toBe(201); expect((await response.json()).requires_email_confirmation).toBe(true);
  });
  it("signs in and only loads the profile linked to the authenticated user", async () => {
    const response = await POST(request("signin", { email: user.email, password: input.password, remember: true }), context("signin"));
    expect(response.status).toBe(200);
    expect(mocks.eq).toHaveBeenCalledWith("auth_user_id", user.id);
    expect(response.cookies.get("mentorflow-refresh")!.maxAge).toBe(30 * 86400);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("does not allow mentor or unrelated Auth accounts to use entrepreneur sign-in", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { id: user.id, role: "mentor" }, error: null });
    const response = await POST(request("signin", { email: user.email, password: input.password }), context("signin"));
    expect(response.status).toBe(403); expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it.each([
    ["invalid_credentials", 401], ["email_not_confirmed", 403], ["over_email_send_rate_limit", 429],
  ])("returns a safe %s error", async (code, status) => {
    mocks.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: { code, message: "sensitive provider detail" } });
    const response = await POST(request("signin", { email: user.email, password: input.password }), context("signin"));
    expect(response.status).toBe(status); expect(JSON.stringify(await response.json())).not.toContain("sensitive");
  });
  it("does not contact Supabase for a guest session", async () => {
    const response = await GET(new NextRequest("https://app.example/api/auth/me"), context("me"));
    expect(await response.json()).toEqual({ ok: true, account: null });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("validates session identity with getUser rather than trusting cookie claims", async () => {
    const response = await GET(new NextRequest("https://app.example/api/auth/me", { headers: { cookie: "mentorflow-access=an-access-token" } }), context("me"));
    expect(mocks.getUser).toHaveBeenCalledWith("an-access-token");
    expect((await response.json()).account.id).toBe(user.id);
    expect(mocks.loadEntrepreneur).toHaveBeenCalledWith(user.id);
  });
  it("refreshes expired sessions and sends rotated cookies", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401, name: "AuthApiError" } });
    mocks.refreshSession.mockResolvedValue({ data: { user, session }, error: null });
    const response = await GET(new NextRequest("https://app.example/api/auth/me", { headers: { cookie: "mentorflow-access=expired; mentorflow-refresh=valid-refresh" } }), context("me"));
    expect((await response.json()).account.id).toBe(user.id);
    expect(response.cookies.get("mentorflow-refresh")!.value).toBe(session.refresh_token);
  });
  it("preserves cookies during an Auth outage and rejects forged/expired sessions", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status: 503, name: "AuthApiError" } });
    const req = new NextRequest("https://app.example/api/auth/me", { headers: { cookie: "mentorflow-access=forged" } });
    const outage = await GET(req, context("me"));
    expect(outage.status).toBe(503); expect(outage.headers.get("set-cookie")).toBeNull();
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401, name: "AuthApiError" } });
    const expired = await GET(req, context("me"));
    expect((await expired.json()).account).toBeNull();
    expect(expired.cookies.get("mentorflow-access")!.maxAge).toBe(0);
    expect(mocks.loadEntrepreneur).not.toHaveBeenCalled();
  });
  it("signs out through Auth and clears session cookies", async () => {
    const response = await POST(request("signout", {}, { cookie: "mentorflow-access=valid" }), context("signout"));
    expect(mocks.adminSignOut).toHaveBeenCalledWith("valid", "local");
    expect(response.cookies.get("mentorflow-access")!.maxAge).toBe(0);
    expect(response.cookies.get("mentorflow-refresh")!.maxAge).toBe(0);
  });
  it("resends a confirmation with a generic response", async () => {
    mocks.resend.mockResolvedValue({ error: null });
    const response = await POST(request("resend", { email: user.email }), context("resend"));
    expect(response.status).toBe(200);
    expect(mocks.resend).toHaveBeenCalledWith(expect.objectContaining({ type: "signup", email: user.email }));
  });
});
