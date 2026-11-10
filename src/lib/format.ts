// Formatting helpers safe for client and server.

const DAY = 86_400_000;

export function formatNu(n: number): string {
  return `Nu. ${Math.round(n).toLocaleString("en-IN")}`;
}

export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export function formatDayTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "due in 3 days", "due today", "2 days overdue", relative to the demo clock. */
export function relativeDue(dueIso: string | null, nowIso: string): string {
  if (!dueIso) return "";
  const days = Math.round((startOfDay(dueIso) - startOfDay(nowIso)) / DAY);
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days > 1) return `due in ${days} days`;
  if (days === -1) return "1 day overdue";
  return `${-days} days overdue`;
}

function startOfDay(iso: string): number {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export const TRIGGER_LABEL: Record<string, string> = {
  "assessment.completed": "Needs assessment completed",
  "mentor.match.requested": "Mentor match requested",
  "mentor.selected": "Mentee asked for a mentor",
  "mentor.request.declined": "Mentor declined a request",
  "mentor.request.expired": "Mentor request expired (no reply)",
  "booking.confirmed": "Booking confirmed",
  "session.completed": "Session completed",
  "action.due_soon": "Scheduled check-in",
  "action.overdue": "Action overdue",
  "entrepreneur.blocked": "Entrepreneur reported a blocker",
  "checkin.replied": "Mentee replied to a check-in",
  "escalation.requested": "Escalation requested",
  "coach.started": "Beginner coach started",
  "coach.replied": "Mentee reported on a coach step",
};
