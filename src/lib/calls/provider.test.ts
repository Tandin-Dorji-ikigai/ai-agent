import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { CALL_PROVIDERS, type CallView } from "../state-types";
import { CallProviderError, callProvider, createRoom, joinToken, type CallProviderName } from "./provider";

describe("call provider types", () => {
  it("every provider the server creates fits the shared call state (and the database check)", () => {
    // Fails `npm run typecheck` if the two drift apart again.
    expectTypeOf<CallProviderName>().toExtend<CallView["provider"]>();
    expect(CALL_PROVIDERS).toEqual(["livekit", "daily", "none"]);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function setLivekit() {
  vi.stubEnv("LIVEKIT_URL", "wss://demo.livekit.cloud");
  vi.stubEnv("LIVEKIT_API_KEY", "APItestkey");
  vi.stubEnv("LIVEKIT_API_SECRET", "test-secret-test-secret-test-secret-123");
}

const payload = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());

describe("video provider (LiveKit)", () => {
  it("uses no video provider without LiveKit settings (recording and transcripts still work)", async () => {
    vi.stubEnv("LIVEKIT_URL", "");
    expect(callProvider()).toBe("none");
    expect(await createRoom("ydf-x")).toBeNull();
    expect(await joinToken("ydf-x", "mentor", "Deki Wangmo", 60)).toBeNull();
  });

  it("signs a personal pass for ONE room, one person, that expires", async () => {
    setLivekit();
    expect(callProvider()).toBe("livekit");
    const p = payload((await joinToken("ydf-x", "mentor", "Deki Wangmo", 3600))!);
    expect(p.sub).toBe("mentor");
    expect(p.name).toBe("Deki Wangmo");
    expect(p.video).toMatchObject({ room: "ydf-x", roomJoin: true, canPublish: true, canSubscribe: true });
    expect(p.video.roomCreate).toBeUndefined();
    expect(p.exp - p.nbf).toBeLessThanOrEqual(3600);
  });

  it("fails clearly if LiveKit refuses to create the room", async () => {
    setLivekit();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "unauthenticated" }), { status: 401 })));
    await expect(createRoom("ydf-y")).rejects.toBeInstanceOf(CallProviderError);
  });
});
