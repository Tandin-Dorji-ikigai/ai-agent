import { buildSeedPayload } from "@/lib/demo/seed-data";
import { handleError, ok } from "@/lib/http";
import { db, must } from "@/lib/supabase/server";

// POST /api/demo/reset: restores the known starting state in one transaction.
// Safe to run repeatedly between rehearsals.
export async function POST() {
  try {
    const counts = must(await db().rpc("reset_demo", { p_seed: buildSeedPayload() }), "reset demo");
    return ok({ counts });
  } catch (err) {
    return handleError(err);
  }
}
