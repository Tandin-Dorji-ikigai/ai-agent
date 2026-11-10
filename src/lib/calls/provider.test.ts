import { afterEach, describe, expect, it, vi } from "vitest";
import { CallProviderError, callProvider, createRoom, joinLink } from "./provider";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("video provider", () => {
  it("uses no video provider without a Daily key (recording and transcripts still work)", async () => {
    vi.stubEnv("DAILY_API_KEY", "");
    expect(callProvider()).toBe("none");
    expect(await createRoom("ydf-x", new Date())).toBeNull();
  });

  it("creates a PRIVATE two-person Daily room that expires", async () => {
    vi.stubEnv("DAILY_API_KEY", "test-key");
    const fetch = vi.fn().mockResolvedValue(json(200, { url: "https://team.daily.co/ydf-x", name: "ydf-x" }));
    vi.stubGlobal("fetch", fetch);
    const exp = new Date("2026-11-12T10:00:00Z");
    expect(await createRoom("ydf-x", exp)).toBe("https://team.daily.co/ydf-x");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toMatch(/\/rooms$/);
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body)).toEqual({
      name: "ydf-x",
      privacy: "private",
      properties: { exp: exp.getTime() / 1000, eject_at_room_exp: true, max_participants: 2, enable_prejoin_ui: true },
    });
  });

  it("finds the room if it already exists, and fails clearly if Daily refuses", async () => {
    vi.stubEnv("DAILY_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(400, { info: "already exists" })).mockResolvedValueOnce(json(200, { url: "https://team.daily.co/ydf-x" })));
    expect(await createRoom("ydf-x", new Date())).toBe("https://team.daily.co/ydf-x");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(401, { error: "authorization-header-error" })));
    await expect(createRoom("ydf-y", new Date())).rejects.toBeInstanceOf(CallProviderError);
  });

  it("gives each participant a personal link with a meeting token", async () => {
    vi.stubEnv("DAILY_API_KEY", "test-key");
    const fetch = vi.fn().mockResolvedValue(json(200, { token: "tok123" }));
    vi.stubGlobal("fetch", fetch);
    const link = await joinLink("https://team.daily.co/ydf-x", "ydf-x", "Deki Wangmo", true, new Date("2026-11-12T10:00:00Z"));
    expect(link).toBe("https://team.daily.co/ydf-x?t=tok123");
    expect(JSON.parse(fetch.mock.calls[0][1].body).properties).toMatchObject({ room_name: "ydf-x", user_name: "Deki Wangmo", is_owner: true });
  });
});
