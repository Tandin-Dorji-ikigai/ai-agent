import { describe, expect, it } from "vitest";
import { buildAgenda } from "./progress";
import type { ActionItemRecord, ProgressUpdateRecord } from "./types";

const action = (id: string, title: string, status: ActionItemRecord["status"]): ActionItemRecord => ({
  id,
  session_id: "s",
  entrepreneur_id: "e",
  title,
  description: null,
  owner: "entrepreneur",
  due_in_days: 4,
  due_at: "2026-11-14T00:00:00Z",
  status,
  blocker: null,
  success_measure: null,
  next_check_in_at: null,
  last_check_in_at: null,
  confirmed_at: "2026-11-10T00:00:00Z",
  created_at: "2026-11-10T00:00:00Z",
});
const update = (action_item_id: string, kind: ProgressUpdateRecord["kind"], note: string, at: string): ProgressUpdateRecord => ({
  id: `${action_item_id}-${at}`,
  entrepreneur_id: "e",
  action_item_id,
  kind,
  note,
  agenda: kind !== "on_track",
  source: "fallback",
  created_at: at,
});

describe("buildAgenda", () => {
  it("puts what needs the mentor first and uses the latest update per action", () => {
    const agenda = buildAgenda({
      entrepreneurFirstName: "Pema",
      actions: [
        action("a1", "Permits", "blocked"),
        action("a2", "Interviews", "pending"),
        action("a3", "Positioning", "completed"),
        action("a4", "Draft only", "draft"),
      ],
      updates: [
        update("a2", "obstacle", "Was sick", "2026-11-12T00:00:00Z"),
        update("a2", "on_track", "Three done", "2026-11-13T00:00:00Z"),
        update("a1", "escalated", "ESC-101", "2026-11-15T00:00:00Z"),
      ],
      escalations: [{ code: "ESC-101", action_item_id: "a1", status: "open" }],
    });
    expect(agenda.map((a) => a.kind)).toEqual(["escalated", "on_track", "done"]);
    expect(agenda[0].text).toContain("ESC-101");
    expect(agenda.some((a) => a.text.includes("Draft only"))).toBe(false);
  });

  it("is empty before any confirmed actions exist", () => {
    expect(buildAgenda({ entrepreneurFirstName: "Pema", actions: [], updates: [], escalations: [] })).toEqual([]);
  });
});
