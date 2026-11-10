import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, asApiError } from "./client-api";

afterEach(() => vi.unstubAllGlobals());

describe("client API transport", () => {
  it("returns a successful server result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true, booking_id: "booking" })));
    await expect(apiRequest("/api/booking")).resolves.toEqual({ ok: true, booking_id: "booking" });
  });

  it("preserves server error codes for query and mutation error states", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: false, code: "INSUFFICIENT_CREDIT", message: "Not enough credit." }, { status: 409 })));
    const error = await apiRequest("/api/booking").catch(error => asApiError(error));
    expect(error).toEqual({ ok: false, code: "INSUFFICIENT_CREDIT", message: "Not enough credit." });
  });

  it("does not report success when a saved action's agent step fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true, outcome: { status: "failed" } })));
    await expect(apiRequest("/api/session/complete")).rejects.toMatchObject({ detail: { code: "AGENT_FAILED" } });
  });

  it("handles non-JSON server responses with a safe message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    await expect(apiRequest("/api/state")).rejects.toMatchObject({ detail: { code: "INVALID_RESPONSE" } });
  });

  it("passes the query cancellation signal to fetch", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    await apiRequest("/api/state", { signal: controller.signal });
    expect(fetcher).toHaveBeenCalledWith("/api/state", expect.objectContaining({ signal: controller.signal }));
  });
});
