import { describe, expect, it } from "vitest";
import { describeWeeklySlots, formatSlot, upcomingSlots, validSlots } from "./slots";

// Tuesday 10 Nov 2026, 15:00 in Bhutan (09:00 UTC).
const NOW = new Date("2026-11-10T09:00:00.000Z");

describe("upcoming session times from a mentor's usual weekly times", () => {
  it("turns weekly times into the next dates, in Bhutan time, earliest first", () => {
    const slots = upcomingSlots(
      [
        { day: "thu", time: "10:00" },
        { day: "tue", time: "17:30" },
        { day: "sat", time: "15:00" },
      ],
      NOW,
    );
    expect(slots.map(formatSlot)).toEqual(["Thu 12 Nov, 10:00", "Sat 14 Nov, 15:00", "Tue 17 Nov, 17:30"]);
    // 10:00 in Bhutan is 04:00 UTC.
    expect(slots[0]).toBe("2026-11-12T04:00:00.000Z");
  });

  it("leaves time to prepare: nothing earlier than 20 hours from now", () => {
    // Today 17:30 is 2.5 hours away; next Tuesday is the first one offered.
    expect(upcomingSlots([{ day: "tue", time: "17:30" }], NOW).map(formatSlot)).toEqual(["Tue 17 Nov, 17:30"]);
  });

  it("handles a Bhutan date that is still the previous day in UTC", () => {
    // 01:00 UTC on Wed 11 Nov is 07:00 on Wed in Bhutan.
    const early = new Date("2026-11-11T01:00:00.000Z");
    expect(upcomingSlots([{ day: "thu", time: "08:00" }], early, { minLeadHours: 1 }).map(formatSlot)).toEqual([
      "Thu 12 Nov, 08:00",
    ]);
  });

  it("offers at most four times", () => {
    const daily = (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const).map((day) => ({ day, time: "09:00" }));
    expect(upcomingSlots(daily, NOW)).toHaveLength(4);
  });

  it("ignores malformed times and returns nothing without usual times", () => {
    expect(validSlots([{ day: "tue", time: "25:00" }, { day: "funday", time: "10:00" }, null, { day: "wed", time: "09:15" }])).toEqual([
      { day: "wed", time: "09:15" },
    ]);
    expect(upcomingSlots([], NOW)).toEqual([]);
  });

  it("describes usual times for a profile", () => {
    expect(describeWeeklySlots([{ day: "tue", time: "17:30" }, { day: "sat", time: "15:00" }])).toBe("Tuesdays 17:30, Saturdays 15:00");
  });
});
