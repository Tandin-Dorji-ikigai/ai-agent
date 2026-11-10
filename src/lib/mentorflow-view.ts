// What the MentorFlow screens show about the agent's mentor request, worked
// out from the shared state (/api/state). Pure, so it is unit-tested.

import { formatNu } from "./format";
import { formatBhutanDay, formatSlot } from "./matching/slots";
import type { DemoState, MentorRequestView } from "./state-types";
import { DECLINE_REASON_LABEL } from "./types";

export type RequestPhase = "none" | "waiting" | "booked" | "escalated" | "stopped";

export interface RequestSummary {
  phase: RequestPhase;
  /** The mentor deciding right now (waiting) or who accepted (booked). */
  current: MentorRequestView | null;
  /** Who the agent asks if the current mentor cannot. */
  nextName: string | null;
  /** One line per mentor asked, oldest first. */
  timeline: Array<{ id: string; name: string; outcome: string; tone: "info" | "success" | "neutral" }>;
  /** Plain sentence for the entrepreneur. */
  headline: string;
  detail: string;
}

const first = (name: string) => name.split(" ")[0];

function outcome(r: MentorRequestView): { text: string; tone: "info" | "success" | "neutral" } {
  switch (r.status) {
    case "pending":
      return { text: `Deciding, reply due ${formatBhutanDay(r.expires_at)}`, tone: "info" };
    case "accepted":
      return { text: `Accepted: ${formatSlot(r.scheduled_at)}`, tone: "success" };
    case "declined":
      return { text: `Declined: ${r.decline_reason ? DECLINE_REASON_LABEL[r.decline_reason].toLowerCase() : "no reason given"}`, tone: "neutral" };
    case "expired":
      return { text: "No reply in time", tone: "neutral" };
    default:
      return { text: "Request cancelled", tone: "neutral" };
  }
}

export function requestSummary(state: Pick<DemoState, "request_round" | "booking" | "matches"> | null | undefined): RequestSummary {
  const round = state?.request_round ?? null;
  const timeline = (round?.requests ?? []).map((r) => ({ id: r.id, name: r.mentor.full_name, ...(({ text, tone }) => ({ outcome: text, tone }))(outcome(r)) }));
  const nextName = round?.next_mentor?.mentor.full_name ?? null;
  const base = { nextName, timeline };

  if (state?.booking && state.booking.status !== "cancelled" && (!round || round.status === "accepted")) {
    const current = round?.requests.find((r) => r.status === "accepted") ?? null;
    return { ...base, phase: "booked", current, headline: "Your session is booked", detail: `${formatSlot(state.booking.scheduled_at)}, Bhutan time.` };
  }
  if (round?.status === "waiting") {
    const current = round.requests.find((r) => r.status === "pending") ?? null;
    const name = current?.mentor.full_name ?? "a mentor";
    const which = round.kind === "direct" ? (current?.mentee_summary.follow_up ? " for a follow-up" : "") : current?.attempt === 1 ? ", your best match," : ", your next best match,";
    const paid = current ? `If ${first(name)} accepts, the session (${formatNu(current.fee)}) is ${current.funding_type === "ydf_credit" ? "paid with your YDF credit" : "self-paid (simulated)"}. Nothing is booked or paid before that.` : "";
    const then = nextName && current ? ` If ${first(name)} cannot, I will ask ${nextName} next.` : "";
    return {
      ...base,
      phase: "waiting",
      current,
      headline: `Asking ${name}`,
      detail: `I have asked ${name}${which} and am waiting for a reply by ${current ? formatBhutanDay(current.expires_at) : "soon"}. ${paid}${then}`.trim(),
    };
  }
  if (round?.status === "escalated") {
    return {
      ...base,
      phase: "escalated",
      current: null,
      headline: "YDF is helping you find a mentor",
      detail:
        round.requests.length > 0
          ? `None of the mentors I asked can take you on right now, so a YDF programme officer will help (${round.escalation_code}).`
          : `No available mentor fits your needs well enough right now, so a YDF programme officer will help (${round.escalation_code}).`,
    };
  }
  if (round?.status === "stopped") {
    return { ...base, phase: "stopped", current: null, headline: "Picking your request up again", detail: "The request stopped before a mentor said yes. I am asking again." };
  }
  return {
    ...base,
    phase: "none",
    current: null,
    headline: (state?.matches.length ?? 0) > 0 ? "Asking your best match" : "Find your mentor",
    detail: (state?.matches.length ?? 0) > 0 ? "I am asking your best-matched mentor now. That mentor decides." : "Share your needs, and I will find and ask the right mentor for you.",
  };
}
