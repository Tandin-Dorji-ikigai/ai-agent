#!/usr/bin/env node
// Rebuilds supabase/APPLY_ALL.sql: every migration in order, in one file, for
// pasting into the Supabase SQL Editor on a NEW, empty project.
// Run after adding a migration:  npm run db:apply-all
// (A unit test fails if the file is out of date.)

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildApplyAll } from "./apply-all-lib.mjs";

const dir = new URL("../supabase/migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const out = buildApplyAll(files.map((name) => ({ name, sql: readFileSync(new URL(name, dir), "utf8") })));
writeFileSync(new URL("../supabase/APPLY_ALL.sql", import.meta.url), out);
console.log(`supabase/APPLY_ALL.sql rebuilt from ${files.length} migrations.`);
