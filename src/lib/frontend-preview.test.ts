import { describe, expect, it, vi } from "vitest";
import { createPreviewState, updatePreview, isPreviewParticipantPresent } from "./frontend-preview";
import type { FrontendState } from "./frontend-types";
import { PEMA_ASSESSMENT_ANSWERS } from "./demo/fixtures";

const now = "2030-01-01T00:00:00.000Z";
const slot = { starts_at: "2030-01-02T04:00:00.000Z", ends_at: "2030-01-02T05:00:00.000Z" };
function step(state: FrontendState, path: string, body = {}) { return updatePreview(state, path, body, now); }
function pending() {
  const state = createPreviewState(now);
  return step(state, "/api/workflow/request", { mentor_id: state.mentor_for_view!.id });
}
function accepted() {
  const state = pending();
  return step(state, "/api/workflow/respond", { request_id: state.workflow.current_request!.id, decision: "accepted" });
}
function available() {
  const state = accepted();
  return step(state, "/api/workflow/availability", { mentor_id: state.mentor_for_view!.id, slots: [slot] });
}
function bookingBody(state: FrontendState) {
  return { mentor_id: state.mentor_for_view!.id, request_id: state.workflow.current_request!.id, slot_id: state.workflow.availability[0].id, funding_type: "ydf_credit", idempotency_key: "frontend-test-booking" };
}
function booked() { const state = available(); return step(state, "/api/booking", bookingBody(state)); }

describe("frontend mentorship preview", () => {
  it("starts with existing sample mentors and no stale booking or fake request", () => {
    const state = createPreviewState(now);
    expect(state.mentor_for_view!.full_name).toBe("Deki Wangmo");
    expect(state.booking).toBeNull();
    expect(state.workflow.current_request).toBeNull();
  });
  it("shares request acceptance with the entrepreneur and rejects duplicate responses", () => {
    const state = pending();
    const next = step(state, "/api/workflow/respond", { request_id: state.workflow.current_request!.id, decision: "accepted" });
    expect(state.workflow.current_request!.status).toBe("pending");
    expect(next.workflow.current_request!.status).toBe("accepted");
    expect(next.messages[0].body).toContain("accepted");
    expect(() => step(next, "/api/workflow/respond", { request_id: next.workflow.current_request!.id, decision: "declined" })).toThrow("no longer waiting");
  });
  it("allows a new request after a decline and keeps refresh from replacing an active request", () => {
    const state = pending();
    expect(step(state, "/api/matches").workflow.current_request!.id).toBe(state.workflow.current_request!.id);
    const declined = step(state, "/api/workflow/respond", { request_id: state.workflow.current_request!.id, decision: "declined" });
    expect(declined.messages[0].body).toContain("declined");
    expect(step(declined, "/api/workflow/request", { mentor_id: declined.mentor_for_view!.id }).workflow.current_request!.status).toBe("pending");
  });
  it("requires mentor acceptance and a published unreserved future time", () => {
    const state = pending();
    const published = step(state, "/api/workflow/availability", { mentor_id: state.mentor_for_view!.id, slots: [slot] });
    expect(() => step(published, "/api/booking", bookingBody(published))).toThrow("must accept");
    const valid = available();
    expect(() => step(valid, "/api/booking", { ...bookingBody(valid), slot_id: crypto.randomUUID() })).toThrow("no longer available");
  });
  it("rejects past and overlapping availability while allowing an empty schedule", () => {
    const state = accepted();
    const save = (slots: typeof slot[]) => step(state, "/api/workflow/availability", { mentor_id: state.mentor_for_view!.id, slots });
    expect(() => save([{ starts_at: "2029-01-01T00:00:00.000Z", ends_at: "2029-01-01T01:00:00.000Z" }])).toThrow("future times");
    expect(() => save([slot, { ...slot, starts_at: "2030-01-02T04:30:00.000Z" }])).toThrow("overlap");
    expect(save([]).workflow.availability).toHaveLength(0);
  });
  it("reserves one slot and deducts preview credit once even after a retry", () => {
    const state = available();
    const body = bookingBody(state);
    const next = step(state, "/api/booking", body);
    const retry = step(next, "/api/booking", body);
    expect(retry.booking!.id).toBe(next.booking!.id);
    expect(retry.credit!.amount_remaining).toBe(1500);
    expect(retry.workflow.availability[0].booking_id).toBe(retry.booking!.id);
    expect(retry.workflow.current_request!.booking_id).toBe(retry.booking!.id);
  });
  it("blocks insufficient credit and lets self payment proceed", () => {
    const state = available();
    state.credit!.amount_remaining = 0;
    expect(() => step(state, "/api/booking", bookingBody(state))).toThrow("Insufficient");
    expect(step(state, "/api/booking", { ...bookingBody(state), funding_type: "self_paid" }).booking!.funding_type).toBe("self_paid");
  });
  it("keeps booked times when the mentor replaces open availability", () => {
    const state = booked();
    const next = step(state, "/api/workflow/availability", { mentor_id: state.mentor_for_view!.id, slots: [] });
    expect(next.workflow.availability[0].booking_id).toBe(state.booking!.id);
    expect(() => step(state, "/api/workflow/availability", { mentor_id: state.mentor_for_view!.id, slots: [slot] })).toThrow("booked session");
  });
  it("clears stale requests on assessment changes, preserving existing bookings", () => {
    expect(step(pending(), "/api/assessment", PEMA_ASSESSMENT_ANSWERS).workflow.current_request).toBeNull();
    expect(() => step(booked(), "/api/assessment", PEMA_ASSESSMENT_ANSWERS)).toThrow("reset the frontend preview");
  });
  it("saves notes and sends only human-confirmed sample actions to the entrepreneur", () => {
    let state = booked();
    state = step(state, "/api/session/complete", { booking_id: state.booking!.id, notes: "My custom session notes" });
    expect(state.session!.mentor_notes).toBe("My custom session notes");
    expect(state.session!.agent_summary).toContain("no AI extraction");
    expect(state.actions.every(action => action.status === "draft")).toBe(true);
    state = step(state, "/api/actions/confirm", { session_id: state.session!.id, action_ids: [state.actions[0].id] });
    expect(state.actions).toHaveLength(1);
    expect(state.actions[0].status).toBe("pending");
    state = step(state, "/api/actions/status", { action_id: state.actions[0].id, status: "completed" });
    expect(state.metrics.actions_completed).toBe(1);
  });
  it("keeps call presence and chat attached to the booking, with expired peers removed", () => {
    let state = booked();
    const payload = { booking_id: state.booking!.id, role: "mentor" };
    state = step(state, "/api/preview/call", { ...payload, action: "join" });
    expect(isPreviewParticipantPresent(state, "mentor", Date.parse(now) + 1000)).toBe(true);
    expect(isPreviewParticipantPresent(state, "mentor", Date.parse(now) + 31000)).toBe(false);
    state = step(state, "/api/preview/call", { ...payload, action: "message", body: "Hello from the mentor" });
    expect(state.workflow.call.messages[0].body).toBe("Hello from the mentor");
    state = step(state, "/api/preview/call", { ...payload, action: "leave" });
    expect(state.workflow.call.participants.mentor).toBeUndefined();
    expect(() => step(state, "/api/preview/call", { ...payload, booking_id: crypto.randomUUID(), action: "join" })).toThrow("upcoming booking");
  });
  it("resets only frontend state and refuses backend-only operations", () => {
    expect(step(booked(), "/api/demo/reset").booking).toBeNull();
    expect(() => step(booked(), "/api/demo/fast-forward", { days: 5 })).toThrow("needs the backend");
  });
  it("does not send browser preview reads or writes over HTTP", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) }, dispatchEvent: vi.fn() });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    try {
      const { frontendRequest } = await import("./frontend-api");
      const state = await frontendRequest<FrontendState>("/api/state");
      await frontendRequest("/api/workflow/request", { method: "POST", body: JSON.stringify({ mentor_id: state.mentor_for_view!.id }) });
      const refreshed = await frontendRequest<FrontendState>("/api/state");
      expect(refreshed.workflow.current_request!.status).toBe("pending");
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
