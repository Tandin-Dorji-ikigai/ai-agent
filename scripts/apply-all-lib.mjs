// Shared by scripts/build-apply-all.mjs and its unit test.
export function buildApplyAll(migrations) {
  const header =
    "-- GENERATED FILE. Do not edit by hand: run `npm run db:apply-all`.\n" +
    "-- Every migration in supabase/migrations/, in order, for pasting into the\n" +
    "-- Supabase SQL Editor on a NEW, empty project. On an existing project, use\n" +
    "-- `npx supabase db push` instead (it applies only the missing migrations).\n" +
    `-- Includes: ${migrations.map((m) => m.name).join(", ")}\n\n`;
  return header + migrations.map((m) => `-- ===== ${m.name} =====\n${m.sql.replace(/\r\n/g, "\n").trim()}\n`).join("\n");
}
