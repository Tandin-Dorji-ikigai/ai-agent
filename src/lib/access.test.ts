import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  API_RULES,
  accessCookieValue,
  accessToken,
  gateOn,
  mayOpen,
  nextAfterSignIn,
  roleForPassword,
  roleFromCookie,
  rolePasswords,
  safeNext,
  sameText,
} from "./access";

const PASSWORDS = { entrepreneur: "pema-2026", mentor: "deki-2026", ydf: "ydf-2026", team: "team-2026" } as const;

describe("role passwords", () => {
  it("reads only the passwords that are set; none set = no sign-in", () => {
    expect(rolePasswords({ MENTOR_PASSWORD: "m", ENTREPRENEUR_PASSWORD: "", DEMO_PASSWORD: "t" })).toEqual({ mentor: "m", team: "t" });
    expect(gateOn(rolePasswords({}))).toBe(false);
    expect(gateOn(rolePasswords({ YDF_PASSWORD: "y" }))).toBe(true);
  });

  it("stores a keyed hash bound to the role, never the password", async () => {
    const a = await accessToken("mentor", "tashi-delek-2026");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("tashi");
    expect(await accessToken("mentor", "tashi-delek-2026")).toBe(a);
    expect(await accessToken("entrepreneur", "tashi-delek-2026")).not.toBe(a);
    expect(await accessToken("mentor", "another")).not.toBe(a);
  });

  it("the password alone decides the role", async () => {
    expect(await roleForPassword("pema-2026", PASSWORDS)).toBe("entrepreneur");
    expect(await roleForPassword("deki-2026", PASSWORDS)).toBe("mentor");
    expect(await roleForPassword("ydf-2026", PASSWORDS)).toBe("ydf");
    expect(await roleForPassword("team-2026", PASSWORDS)).toBe("team");
    expect(await roleForPassword("wrong", PASSWORDS)).toBeNull();
    expect(await roleForPassword("Deki-2026", PASSWORDS)).toBeNull(); // case matters
  });

  it("if two roles were given the same password by mistake, the one with fewer rights wins", async () => {
    expect(await roleForPassword("same", { team: "same", mentor: "same" })).toBe("mentor");
    expect(await roleForPassword("same", { mentor: "same", entrepreneur: "same" })).toBe("entrepreneur");
  });

  it("a cookie proves its role only while that role's password is unchanged", async () => {
    const cookie = await accessCookieValue("mentor", PASSWORDS.mentor);
    expect(cookie.startsWith("mentor.")).toBe(true);
    expect(await roleFromCookie(cookie, PASSWORDS)).toBe("mentor");
    // Relabelled as another role: rejected.
    expect(await roleFromCookie(cookie.replace("mentor.", "team."), PASSWORDS)).toBeNull();
    expect(await roleFromCookie(cookie.replace("mentor.", "entrepreneur."), PASSWORDS)).toBeNull();
    // Password changed, or that role switched off: rejected.
    expect(await roleFromCookie(cookie, { ...PASSWORDS, mentor: "new-password" })).toBeNull();
    expect(await roleFromCookie(cookie, { entrepreneur: PASSWORDS.entrepreneur })).toBeNull();
    // Missing or malformed.
    for (const bad of [undefined, "", "mentor", ".abc", "admin.abc", `mentor.${"0".repeat(64)}`]) {
      expect(await roleFromCookie(bad, PASSWORDS)).toBeNull();
    }
  });

  it("compares safely", () => {
    expect(sameText("abc", "abc")).toBe(true);
    expect(sameText("abc", "abd")).toBe(false);
    expect(sameText("abc", "abcd")).toBe(false);
  });
});

describe("who may open what", () => {
  it("everyone may reach the sign-in pages; nothing else without signing in", () => {
    for (const path of ["/login", "/access", "/entrepreneur/login", "/mentor/login", "/api/access"]) expect(mayOpen(null, path)).toBe(true);
    for (const path of ["/", "/entrepreneur/connect", "/mentor/dashboard", "/ydf", "/api/state", "/api/demo/reset"]) expect(mayOpen(null, path)).toBe(false);
  });

  it("the entrepreneur gets the entrepreneur screens and actions only", () => {
    for (const path of ["/", "/get-started", "/entrepreneur/connect", "/entrepreneur/call", "/entrepreneur/sign-up/idea", "/api/state", "/api/requests/start", "/api/assessment", "/api/calls/join", "/api/transcribe"]) {
      expect(mayOpen("entrepreneur", path), path).toBe(true);
    }
    for (const path of ["/mentor/dashboard", "/mentor/call", "/ydf", "/api/requests/accept", "/api/requests/decline", "/api/actions/confirm", "/api/demo/reset", "/api/dev/extract"]) {
      expect(mayOpen("entrepreneur", path), path).toBe(false);
    }
  });

  it("the mentor gets the mentor screens and actions only", () => {
    for (const path of ["/mentor/dashboard", "/mentor/requests", "/mentor/call", "/api/requests/accept", "/api/requests/decline", "/api/session/complete", "/api/calls/end", "/api/transcribe"]) {
      expect(mayOpen("mentor", path), path).toBe(true);
    }
    for (const path of ["/entrepreneur/connect", "/entrepreneur/call", "/ydf", "/api/requests/start", "/api/requests/ask", "/api/assessment", "/api/demo/fast-forward"]) {
      expect(mayOpen("mentor", path), path).toBe(false);
    }
  });

  it("YDF staff get their page and the demo controls; the team gets everything", () => {
    for (const path of ["/ydf", "/api/demo/reset", "/api/demo/fast-forward", "/api/agent/run", "/api/state"]) expect(mayOpen("ydf", path), path).toBe(true);
    for (const path of ["/entrepreneur/connect", "/mentor/dashboard", "/api/calls/join", "/api/requests/accept"]) expect(mayOpen("ydf", path), path).toBe(false);
    for (const path of ["/", "/entrepreneur/connect", "/mentor/dashboard", "/ydf", "/api/dev/extract", "/api/not-a-route"]) expect(mayOpen("team", path), path).toBe(true);
  });

  it("an API route nobody listed is team-only", () => {
    expect(mayOpen("entrepreneur", "/api/something-new")).toBe(false);
    expect(mayOpen("mentor", "/api/something-new")).toBe(false);
  });

  it("every API route in the app has a rule, and every rule is a real route", () => {
    const apiDir = join(process.cwd(), "src", "app", "api");
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name === "route.ts") routes.push(`/api/${relative(apiDir, dir).split(sep).join("/")}`);
      }
    };
    walk(apiDir);
    expect(routes.length).toBeGreaterThan(10);
    expect(routes.filter((r) => !(r in API_RULES)), "routes without a rule in src/lib/access.ts").toEqual([]);
    expect(Object.keys(API_RULES).filter((r) => !routes.includes(r)), "rules for routes that no longer exist").toEqual([]);
  });
});

describe("where people are sent", () => {
  it("only sends people back to a page on this site", () => {
    expect(safeNext("/mentor/requests?x=1")).toBe("/mentor/requests?x=1");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("/access")).toBe("/");
    expect(safeNext("/mentor/login?next=/x")).toBe("/");
    expect(safeNext("/login")).toBe("/");
    expect(safeNext(undefined)).toBe("/");
  });

  it("one sign-in page: each role lands in its own workspace, or on the page it asked for if allowed", () => {
    expect(nextAfterSignIn("entrepreneur", undefined)).toBe("/entrepreneur/connect");
    expect(nextAfterSignIn("mentor", undefined)).toBe("/mentor/dashboard");
    expect(nextAfterSignIn("mentor", "/mentor/requests")).toBe("/mentor/requests");
    expect(nextAfterSignIn("mentor", "/entrepreneur/connect")).toBe("/mentor/dashboard");
    expect(nextAfterSignIn("entrepreneur", "/")).toBe("/entrepreneur/connect");
    expect(nextAfterSignIn("entrepreneur", "/entrepreneur/call?x=1")).toBe("/entrepreneur/call?x=1");
    expect(nextAfterSignIn("ydf", undefined)).toBe("/ydf");
    expect(nextAfterSignIn("team", "/mentor/dashboard")).toBe("/mentor/dashboard");
    expect(nextAfterSignIn("team", undefined)).toBe("/");
    expect(nextAfterSignIn(null, "/mentor/dashboard")).toBe("/mentor/dashboard"); // sign-in off
    expect(nextAfterSignIn("mentor", "https://evil.example")).toBe("/mentor/dashboard");
  });
});
