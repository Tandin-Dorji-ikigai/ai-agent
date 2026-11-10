import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApplyAll } from "../../../scripts/apply-all-lib.mjs";

const root = join(__dirname, "../../..");
const dir = join(root, "supabase/migrations");

describe("supabase/APPLY_ALL.sql", () => {
  it("contains every migration, in order (run `npm run db:apply-all` after adding one)", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const expected = buildApplyAll(files.map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") })));
    expect(readFileSync(join(root, "supabase/APPLY_ALL.sql"), "utf8")).toBe(expected);
  });
});
