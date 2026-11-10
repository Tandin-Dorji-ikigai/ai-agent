import "server-only";
import { db, must } from "./supabase/server";

// The demo clock. Everything that needs "now" (due dates, message times,
// overdue checks) reads it here, so fast-forward moves the whole app at once.
// It mirrors the SQL function demo_now(); the real system clock is never changed.

export interface DemoClock {
  now: Date;
  offsetDays: number;
}

export async function getDemoClock(): Promise<DemoClock> {
  const row = must(
    await db().from("demo_state").select("clock_offset_days").eq("id", 1).maybeSingle(),
    "read demo clock",
  ) as { clock_offset_days: number };
  const offsetDays = row.clock_offset_days ?? 0;
  return { now: new Date(Date.now() + offsetDays * 86_400_000), offsetDays };
}

export async function demoNow(): Promise<Date> {
  return (await getDemoClock()).now;
}
