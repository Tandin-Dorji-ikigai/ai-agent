// Mentor progress and next-session agenda ("add to mentor progress -> next
// session" in the team workflow). Pure functions: used by the dashboard state
// and by the follow-up session brief.

import type { ActionItemRecord, ProgressUpdateRecord } from "./types";

export type AgendaKind = "help" | "escalated" | "obstacle" | "overdue" | "blocked" | "on_track" | "done";

export interface AgendaItem {
  kind: AgendaKind;
  text: string;
  action_id: string | null;
}

/** Order on the agenda: what needs the mentor most comes first. */
const ORDER: AgendaKind[] = ["help", "escalated", "obstacle", "overdue", "blocked", "on_track", "done"];

export function buildAgenda(input: {
  entrepreneurFirstName: string;
  actions: ActionItemRecord[];
  updates: ProgressUpdateRecord[];
  escalations: Array<{ code: string; action_item_id: string | null; status: string }>;
}): AgendaItem[] {
  const name = input.entrepreneurFirstName;
  const confirmed = input.actions.filter((a) => a.status !== "draft");
  const title = (id: string | null) => confirmed.find((a) => a.id === id)?.title ?? "an action";
  const items: AgendaItem[] = [];
  const covered = new Set<string>();

  // Latest update per action decides what the mentor needs to know.
  const latest = new Map<string, ProgressUpdateRecord>();
  for (const u of [...input.updates].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (u.action_item_id) latest.set(u.action_item_id, u);
  }

  for (const [actionId, u] of latest) {
    const t = title(actionId);
    if (u.kind === "mentor_requested") {
      items.push({ kind: "help", text: `${name} asked for your help with "${t}": ${u.note ?? ""}`.trim(), action_id: actionId });
      covered.add(actionId);
    } else if (u.kind === "escalated") {
      const esc = input.escalations.find((e) => e.action_item_id === actionId && e.status !== "resolved");
      items.push({
        kind: "escalated",
        text: `YDF is handling "${t}"${esc ? ` (${esc.code})` : ""}. Ask ${name} for an update.`,
        action_id: actionId,
      });
      covered.add(actionId);
    } else if (u.kind === "obstacle") {
      items.push({ kind: "obstacle", text: `Obstacle on "${t}": ${u.note ?? ""}`.trim(), action_id: actionId });
      covered.add(actionId);
    } else if (u.kind === "on_track") {
      items.push({ kind: "on_track", text: `On track: "${t}". ${u.note ?? ""}`.trim(), action_id: actionId });
      covered.add(actionId);
    }
  }

  for (const a of confirmed) {
    if (covered.has(a.id)) continue;
    if (a.status === "completed") items.push({ kind: "done", text: `Done: "${a.title}"`, action_id: a.id });
    else if (a.status === "overdue") items.push({ kind: "overdue", text: `Overdue: "${a.title}"`, action_id: a.id });
    else if (a.status === "blocked") items.push({ kind: "blocked", text: `Blocked: "${a.title}"`, action_id: a.id });
  }

  return items.sort((x, y) => ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind));
}
