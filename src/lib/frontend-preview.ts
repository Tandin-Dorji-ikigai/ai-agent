// Browser-only sample data. This module never reads Supabase or calls an API.
import { z } from "zod";
import { ApiRequestError } from "./client-api";
import { AssessmentInputSchema, BookingInputSchema, ConfirmActionsInputSchema, SessionCompleteInputSchema, ActionStatusInputSchema, InboxReplyInputSchema } from "./agent/schemas";
import { SEED_MENTORS, SEED_PEMA, SEED_CREDIT } from "./demo/seed-data";
import { PEMA_ASSESSMENT_ANSWERS, DEMO_EXTRACTED_ACTIONS } from "./demo/fixtures";
import { rankMentors } from "./matching/score-mentor";
import type { FrontendState, WorkspaceRole } from "./frontend-types";

export const PREVIEW_STORAGE_KEY = "mentorflow.frontend.v1";
export const PREVIEW_CHANGE_EVENT = "mentorflow:preview-change";
const roleSchema = z.enum(["mentor", "entrepreneur"]);
const id = z.uuid();

function fail(message: string): never {
  throw new ApiRequestError({ ok: false, code: "PREVIEW_VALIDATION", message });
}

function matchesFor(entrepreneur: NonNullable<FrontendState["entrepreneur"]>) {
  return rankMentors(entrepreneur, SEED_MENTORS).slice(0, 3).map((item, index) => ({
    ...item, rank: index + 1,
    explanation: `Sample match based on your business stage, language, budget and mentorship needs.`,
    explanation_source: "fallback" as const,
  }));
}

export function createPreviewState(now = new Date().toISOString()): FrontendState {
  const entrepreneur = {
    ...SEED_PEMA, ...PEMA_ASSESSMENT_ANSWERS,
    assessment_summary: PEMA_ASSESSMENT_ANSWERS.primary_challenge,
    assessment_completed_at: now,
  };
  const matches = matchesFor(entrepreneur);
  return {
    ok: true, seeded: true, ai_mode: "fixture", clock: { now, offset_days: 0 },
    entrepreneur, credit: { amount_granted: SEED_CREDIT.amount_granted, amount_remaining: SEED_CREDIT.amount_granted, status: "active" },
    matches, most_booked: null, booking: null, session: null,
    actions: [], messages: [], escalations: [], runs: [], steps: [],
    metrics: { credits_used: 0, credits_granted: SEED_CREDIT.amount_granted, sessions_completed: 0, actions_completed: 0, actions_total: 0, open_escalations: 0 },
    mentor_for_view: matches[0]?.mentor ?? null,
    workflow: { current_request: null, availability: [], call: { participants: {}, messages: [] } },
  };
}

function notify(state: FrontendState, body: string, now: string) {
  state.messages.unshift({
    id: crypto.randomUUID(), sender: "agent", kind: "info", body,
    body_dz: null, dz_verified: false, related_action_id: null,
    awaiting_reply: false, metadata: {}, source: "system", created_at: now,
  });
}

// Pure transition function keeps the frontend demo easy to replace and test.
// Validation here is UI feedback; the future backend must enforce its own rules.
export function updatePreview(current: FrontendState, path: string, body: unknown = {}, now = new Date().toISOString()): FrontendState {
  if (path === "/api/demo/reset") return createPreviewState(now);
  const state = structuredClone(current);
  state.clock.now = now;
  const request = state.workflow.current_request;
  switch (path) {
    case "/api/assessment": {
      if (state.booking) fail("Finish testing this booking or reset the frontend preview before starting a new assessment.");
      const input = AssessmentInputSchema.parse(body);
      state.entrepreneur = { ...state.entrepreneur!, ...input, assessment_completed_at: now, assessment_summary: input.primary_challenge };
      state.matches = [];
      state.mentor_for_view = null;
      state.workflow.current_request = null;
      break;
    }
    case "/api/matches": {
      if (state.booking || request?.status === "pending" || request?.status === "accepted") break;
      state.matches = matchesFor(state.entrepreneur!);
      state.mentor_for_view = state.matches[0]?.mentor ?? null;
      state.workflow.current_request = null;
      break;
    }
    case "/api/workflow/request": {
      const input = z.object({ mentor_id: id }).parse(body);
      if (state.booking || request?.status === "pending" || request?.status === "accepted") fail("There is already an active mentorship request.");
      const match = state.matches.find(item => item.mentor.id === input.mentor_id);
      if (!match) fail("Choose a mentor from your current matches.");
      state.workflow.current_request = { id: crypto.randomUUID(), entrepreneur_id: state.entrepreneur!.id, mentor_id: input.mentor_id, status: "pending", booking_id: null };
      state.mentor_for_view = match.mentor;
      notify(state, `Your request was sent to ${match.mentor.full_name}. Waiting for a response.`, now);
      break;
    }
    case "/api/workflow/respond": {
      const input = z.object({ request_id: id, decision: z.enum(["accepted", "declined"]) }).parse(body);
      if (!request || request.id !== input.request_id || request.status !== "pending") fail("This request is no longer waiting for a response.");
      request.status = input.decision;
      notify(state, input.decision === "accepted" ? "Your mentor accepted your request. Choose a published time in My bookings." : "Your mentor declined this request. You can refresh your match and try again.", now);
      break;
    }
    case "/api/workflow/availability": {
      const input = z.object({ mentor_id: id, slots: z.array(z.object({ starts_at: z.iso.datetime(), ends_at: z.iso.datetime() })).max(20) }).parse(body);
      if (state.mentor_for_view?.id !== input.mentor_id) fail("Open the current mentor's workspace to edit availability.");
      const slots = [...input.slots].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (slot.starts_at <= now || slot.ends_at <= slot.starts_at) fail("Choose future times with the end after the start.");
        if (i && slots[i - 1].ends_at > slot.starts_at) fail("Availability times cannot overlap.");
        if (state.workflow.availability.some(saved => saved.booking_id && slot.starts_at < saved.ends_at && slot.ends_at > saved.starts_at)) fail("This time overlaps a booked session.");
      }
      const booked = state.workflow.availability.filter(slot => slot.booking_id);
      state.workflow.availability = [...booked, ...slots.map(slot => {
        const saved = state.workflow.availability.find(item => !item.booking_id && item.starts_at === slot.starts_at && item.ends_at === slot.ends_at);
        return { ...slot, id: saved?.id ?? crypto.randomUUID(), mentor_id: input.mentor_id, booking_id: null };
      })];
      break;
    }
    case "/api/booking": {
      const input = BookingInputSchema.extend({ request_id: id, slot_id: id }).parse(body);
      if (state.booking?.idempotency_key === input.idempotency_key) break;
      if (state.booking) fail("This preview already has a booking.");
      if (!request || request.id !== input.request_id || request.status !== "accepted" || request.mentor_id !== input.mentor_id) fail("Your mentor must accept the request before booking.");
      const slot = state.workflow.availability.find(item => item.id === input.slot_id && item.mentor_id === input.mentor_id && !item.booking_id && item.starts_at > now);
      if (!slot) fail("This time is no longer available. Choose another session time.");
      const mentor = state.mentor_for_view!;
      if (input.funding_type === "ydf_credit") {
        if (!state.credit || state.credit.status !== "active" || state.credit.amount_remaining < mentor.fee) fail("Insufficient sponsorship credit. Choose another funding option.");
        state.credit.amount_remaining -= mentor.fee;
        state.metrics.credits_used += mentor.fee;
      }
      state.booking = {
        id: crypto.randomUUID(), mentor, scheduled_at: slot.starts_at,
        status: "confirmed", fee: mentor.fee, funding_type: input.funding_type, idempotency_key: input.idempotency_key,
        entrepreneur_brief: { headline: "Prepare for a useful conversation", prepare: ["Bring your current challenge and one goal."], questions_to_ask: ["What should I focus on next?"] },
        mentor_brief: { headline: `Session with ${state.entrepreneur!.full_name}`, about: state.entrepreneur!.primary_challenge ?? "", focus: state.entrepreneur!.goals },
        brief_source: "fallback",
      };
      slot.booking_id = state.booking.id;
      request.booking_id = state.booking.id;
      notify(state, "Your session is confirmed. Both workspaces now show the same booking.", now);
      break;
    }
    case "/api/session/complete": {
      const input = SessionCompleteInputSchema.parse(body);
      if (!state.booking || state.booking.id !== input.booking_id) fail("Book a session before saving notes.");
      if (state.session?.completed_at) break;
      const sessionId = crypto.randomUUID();
      state.session = { id: sessionId, booking_id: input.booking_id, mentor_notes: input.notes, agent_summary: "Sample action suggestions for the Pema scenario. Your notes are saved below; no AI extraction runs in frontend mode.", summary_source: "fallback", summary_confirmed: false, completed_at: now };
      state.actions = DEMO_EXTRACTED_ACTIONS.actions.map(action => ({ ...action, id: crypto.randomUUID(), session_id: sessionId, entrepreneur_id: state.entrepreneur!.id, status: "draft", due_at: null, blocker: null, confirmed_at: null, created_at: now }));
      state.booking.status = "completed";
      state.workflow.current_request!.status = "completed";
      state.metrics.sessions_completed = 1;
      state.workflow.call.participants = {};
      break;
    }
    case "/api/actions/confirm": {
      const input = ConfirmActionsInputSchema.parse(body);
      if (!state.session || state.session.id !== input.session_id) fail("The session could not be found.");
      if (state.session.summary_confirmed) break;
      if (!input.action_ids.length || input.action_ids.some(actionId => !state.actions.some(action => action.id === actionId && action.status === "draft"))) fail("Select valid draft actions to confirm.");
      state.actions = state.actions.filter(action => input.action_ids.includes(action.id)).map(action => ({ ...action, status: "pending", confirmed_at: now, due_at: new Date(Date.parse(now) + action.due_in_days * 86400000).toISOString() }));
      state.session.summary_confirmed = true;
      state.metrics.actions_total = state.actions.length;
      notify(state, "Your mentor confirmed your next steps. Review them below.", now);
      break;
    }
    case "/api/actions/status": {
      const input = ActionStatusInputSchema.parse(body);
      const action = state.actions.find(item => item.id === input.action_id && item.status !== "draft");
      if (!action) fail("This action could not be found.");
      action.status = input.status;
      state.metrics.actions_completed = state.actions.filter(item => item.status === "completed").length;
      break;
    }
    case "/api/inbox/reply": {
      const input = InboxReplyInputSchema.parse(body);
      const message = state.messages.find(item => item.id === input.message_id && item.awaiting_reply);
      if (!message) fail("This message is not awaiting a reply.");
      message.awaiting_reply = false;
      notify(state, input.body, now);
      state.messages[0].sender = "entrepreneur";
      state.messages[0].kind = "reply";
      break;
    }
    case "/api/preview/call": {
      const input = z.object({ booking_id: id, role: roleSchema, action: z.enum(["join", "leave", "message"]), body: z.string().trim().min(1).max(1000).optional() }).parse(body);
      if (!state.booking || state.booking.id !== input.booking_id || (state.booking.status === "completed" && input.action !== "leave")) fail("The session room requires an upcoming booking.");
      if (input.action === "leave") delete state.workflow.call.participants[input.role];
      else if (input.action === "join") state.workflow.call.participants[input.role] = Date.parse(now);
      else {
        if (!input.body) fail("Write a message first.");
        state.workflow.call.messages = [...state.workflow.call.messages, { id: crypto.randomUUID(), role: input.role, body: input.body }].slice(-100);
      }
      break;
    }
    default: fail("This operation needs the backend. It is not part of the frontend preview.");
  }
  return state;
}

export function readPreview(): FrontendState {
  const saved = window.localStorage.getItem(PREVIEW_STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as FrontendState;
      if (parsed.ok && parsed.workflow?.call && Array.isArray(parsed.workflow.availability) && parsed.entrepreneur) {
        parsed.clock.now = new Date().toISOString();
        return parsed;
      }
    } catch { /* Discard an obsolete or malformed local preview. */ }
  }
  return createPreviewState();
}

export function writePreview(path: string, body: unknown): FrontendState {
  try {
    const next = updatePreview(readPreview(), path, body);
    window.localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(PREVIEW_CHANGE_EVENT));
    return next;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    if (error instanceof z.ZodError) fail(error.issues.map(issue => issue.message).join(". "));
    throw new ApiRequestError({ ok: false, code: "PREVIEW_STORAGE", message: "Could not save the frontend preview. Allow browser storage and try again." });
  }
}

export function isPreviewParticipantPresent(state: FrontendState | null, role: WorkspaceRole, now = Date.now()) {
  const lastSeen = state?.workflow?.call.participants[role];
  return typeof lastSeen === "number" && now - lastSeen < 30000;
}
