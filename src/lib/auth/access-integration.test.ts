import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { POST as roleSignIn } from "@/app/api/access/route";
import { accessCookieValue, mayOpen } from "../access";

beforeEach(() => {
  vi.stubEnv("MENTOR_PASSWORD", "mentor-test-password");
  vi.stubEnv("ENTREPRENEUR_PASSWORD", "");
  vi.stubEnv("YDF_PASSWORD", "");
  vi.stubEnv("DEMO_PASSWORD", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("personal accounts alongside shared role sign-in", () => {
  it.each(["/account", "/account/login", "/get-started", "/entrepreneur/sign-up/idea", "/entrepreneur/sign-up/exploring", "/api/auth/signup", "/api/auth/signin", "/api/auth/signout", "/api/auth/resend", "/api/auth/me"])("allows the public account shell/handler %s while the role gate is on", async path => {
    const response = await proxy(new NextRequest(`https://app.example${path}`));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(mayOpen(null, path)).toBe(true);
  });
  it("retains the friend's mentor login alias and role permissions", async () => {
    const alias = await proxy(new NextRequest("https://app.example/mentor/login"));
    expect(alias.headers.get("location")).toBe("https://app.example/login");
    const roleCookie = await accessCookieValue("mentor", "mentor-test-password");
    const allowed = await proxy(new NextRequest("https://app.example/api/requests/accept", { headers: { cookie: `mentorflow_access=${roleCookie}` } }));
    expect(allowed.headers.get("x-middleware-next")).toBe("1");
  });
  it("does not let an account cookie impersonate a demo mentor or access shared data", async () => {
    for (const path of ["/api/requests/accept", "/api/state", "/api/demo/reset"]) {
      const response = await proxy(new NextRequest(`https://app.example${path}`, { headers: { cookie: "mentorflow-access=a-personal-token" } }));
      expect(response.status).toBe(401);
    }
  });
  it("switches back to the mentor role without retaining a personal account session", async () => {
    const response = await roleSignIn(new Request("https://app.example/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "mentor-test-password" }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ role: "mentor", next: "/mentor/dashboard" });
    const cookies = response.headers.getSetCookie().join("\n");
    expect(cookies).toContain("mentorflow_access=mentor.");
    for (const name of ["mentorflow-access", "mentorflow-refresh", "mentorflow-remember"]) expect(cookies).toContain(`${name}=; Path=/; Max-Age=0`);
  });
});
