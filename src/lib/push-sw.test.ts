import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Runs public/sw.js against a fake service-worker global: a push becomes a
// notification, and tapping it opens the call screen (only paths on this site).
type Listener = (event: { data?: unknown; notification?: unknown; waitUntil: (p: Promise<unknown>) => void }) => void;

function loadWorker(windows: Array<{ url: string; focus: ReturnType<typeof vi.fn>; navigate: ReturnType<typeof vi.fn> }> = []) {
  const listeners: Record<string, Listener> = {};
  const self = {
    location: { origin: "https://app.example" },
    addEventListener: (type: string, fn: Listener) => (listeners[type] = fn),
    skipWaiting: vi.fn(),
    registration: { showNotification: vi.fn(async () => undefined) },
    clients: { claim: vi.fn(), matchAll: vi.fn(async () => windows), openWindow: vi.fn(async () => undefined) },
  };
  new Function("self", readFileSync(join(process.cwd(), "public", "sw.js"), "utf8"))(self);
  const fire = async (type: string, event: Record<string, unknown>) => {
    let done: Promise<unknown> = Promise.resolve();
    listeners[type]({ ...event, waitUntil: (p) => (done = p) });
    await done;
  };
  return { self, fire };
}

const pushData = (obj: unknown) => ({ json: () => obj, text: () => JSON.stringify(obj) });

describe("service worker (public/sw.js)", () => {
  it("shows the call notification from the push", async () => {
    const { self, fire } = loadWorker();
    await fire("push", { data: pushData({ title: "Pema is in the session room", body: "Tap to join your mentoring call.", url: "/mentor/call", tag: "call-b1" }) });
    expect(self.registration.showNotification).toHaveBeenCalledWith(
      "Pema is in the session room",
      expect.objectContaining({ body: "Tap to join your mentoring call.", tag: "call-b1", data: { url: "/mentor/call" }, icon: "/icon-192.png" }),
    );
  });

  it("never sends a tap to another site", async () => {
    const { self, fire } = loadWorker();
    for (const url of ["https://evil.example/", "//evil.example", "javascript:alert(1)", 42]) {
      await fire("push", { data: pushData({ title: "x", url }) });
    }
    for (const [, options] of self.registration.showNotification.mock.calls as unknown as Array<[string, { data: { url: string } }]>) {
      expect(options.data.url).toBe("/");
    }
  });

  it("copes with an empty or non-JSON push", async () => {
    const { self, fire } = loadWorker();
    await fire("push", { data: { json: () => { throw new Error("not json"); }, text: () => "hello" } });
    expect(self.registration.showNotification).toHaveBeenCalledWith("MentorFlow", expect.objectContaining({ body: "hello" }));
  });

  it("tapping focuses an open MentorFlow window and opens the call there", async () => {
    const win = { url: "https://app.example/mentor/dashboard", focus: vi.fn(async () => undefined), navigate: vi.fn(async () => undefined) };
    const { self, fire } = loadWorker([win]);
    await fire("notificationclick", { notification: { close: vi.fn(), data: { url: "/mentor/call" } } });
    expect(win.focus).toHaveBeenCalled();
    expect(win.navigate).toHaveBeenCalledWith("https://app.example/mentor/call");
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });

  it("tapping with no window open opens one at the call screen", async () => {
    const { self, fire } = loadWorker([]);
    await fire("notificationclick", { notification: { close: vi.fn(), data: { url: "/entrepreneur/call" } } });
    expect(self.clients.openWindow).toHaveBeenCalledWith("https://app.example/entrepreneur/call");
  });
});
