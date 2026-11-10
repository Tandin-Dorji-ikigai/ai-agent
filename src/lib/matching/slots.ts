// Turns a mentor's usual weekly times into concrete session times.
// Pure and timezone-safe: Bhutan has no daylight saving, so Bhutan time is
// always UTC+6, whatever timezone the server or browser runs in.

import { WEEKDAYS, type WeeklySlot } from "../types";

export const BHUTAN_TZ = "Asia/Thimphu";
const BHUTAN_OFFSET_MS = 6 * 3_600_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface SlotOptions {
  /** Earliest time offered, in hours from now (gives both sides time to prepare). Default 20. */
  minLeadHours?: number;
  /** How many days ahead to look. Default 8. */
  days?: number;
  /** Most times to offer. Default 4. */
  max?: number;
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Only well-formed slots ("tue" at "17:30"); anything else is ignored. */
export function validSlots(slots: unknown): WeeklySlot[] {
  if (!Array.isArray(slots)) return [];
  return slots.filter(
    (s): s is WeeklySlot =>
      !!s && typeof s === "object" && WEEKDAYS.includes((s as WeeklySlot).day) && TIME.test(String((s as WeeklySlot).time)),
  );
}

/**
 * The next concrete times (ISO strings, UTC) that match the mentor's weekly
 * times, from `minLeadHours` after `now`, earliest first.
 */
export function upcomingSlots(weekly: WeeklySlot[], now: Date, opts: SlotOptions = {}): string[] {
  const { minLeadHours = 20, days = 8, max = 4 } = opts;
  const slots = validSlots(weekly);
  if (slots.length === 0 || max < 1) return [];

  const earliest = now.getTime() + minLeadHours * HOUR;
  const latest = now.getTime() + days * DAY;
  // Midnight today in Bhutan, expressed as a UTC timestamp.
  const local = now.getTime() + BHUTAN_OFFSET_MS;
  const localMidnight = local - (((local % DAY) + DAY) % DAY);

  const out: number[] = [];
  for (let d = 0; d <= days; d++) {
    const dayStartLocal = localMidnight + d * DAY;
    const weekday = WEEKDAYS[new Date(dayStartLocal).getUTCDay()];
    for (const s of slots) {
      if (s.day !== weekday) continue;
      const [h, m] = s.time.split(":").map(Number);
      const at = dayStartLocal + h * HOUR + m * 60_000 - BHUTAN_OFFSET_MS;
      if (at >= earliest && at <= latest) out.push(at);
    }
  }
  return [...new Set(out)]
    .sort((a, b) => a - b)
    .slice(0, max)
    .map((t) => new Date(t).toISOString());
}

/** "Thu 12 Nov, 17:30" in Bhutan time. */
export function formatSlot(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const day = formatBhutanDay(d);
  const time = d.toLocaleTimeString("en-GB", { timeZone: BHUTAN_TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day}, ${time}`;
}

/** "Thu 12 Nov" in Bhutan time. */
export function formatBhutanDay(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: BHUTAN_TZ, weekday: "short", day: "numeric", month: "short" });
}

/** "Tuesdays 17:30, Thursdays 10:00" for a profile. */
export function describeWeeklySlots(weekly: WeeklySlot[]): string {
  const NAMES: Record<string, string> = {
    sun: "Sundays",
    mon: "Mondays",
    tue: "Tuesdays",
    wed: "Wednesdays",
    thu: "Thursdays",
    fri: "Fridays",
    sat: "Saturdays",
  };
  return validSlots(weekly)
    .map((s) => `${NAMES[s.day]} ${s.time}`)
    .join(", ");
}
