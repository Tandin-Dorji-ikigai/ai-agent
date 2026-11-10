import { describe, expect, it } from "vitest";
import { accessToken, safeNext, sameText } from "./access";

describe("demo password gate", () => {
  it("stores a keyed hash, never the password, and it is stable", async () => {
    const a = await accessToken("tashi-delek-2026");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("tashi");
    expect(await accessToken("tashi-delek-2026")).toBe(a);
    expect(await accessToken("another")).not.toBe(a);
  });

  it("compares safely", () => {
    expect(sameText("abc", "abc")).toBe(true);
    expect(sameText("abc", "abd")).toBe(false);
    expect(sameText("abc", "abcd")).toBe(false);
  });

  it("only sends people back to a page on this site", () => {
    expect(safeNext("/mentor/requests?x=1")).toBe("/mentor/requests?x=1");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("/access")).toBe("/");
    expect(safeNext(undefined)).toBe("/");
  });
});
