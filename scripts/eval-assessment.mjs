#!/usr/bin/env node
// Scores drafting the needs assessment from a spoken introduction against
// evals/assessment-cases.json. Uses POST /api/assessment/draft (saves nothing).
//
//   npm run dev  (AI_MODE=fixture scores the rule-based reader, live scores live AI)
//   npm run eval:assessment
//
// Options: BASE_URL (default http://localhost:3000), PACE_MS (default 1500).

import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PACE_MS = Number(process.env.PACE_MS ?? 1500);
const { cases } = JSON.parse(readFileSync(new URL("../evals/assessment-cases.json", import.meta.url), "utf8"));
const fixtures = await (await fetch(`${BASE}/api/demo/fixtures`)).json();

const empty = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

let scored = 0;
let correct = 0;
let invented = 0;
let sources = new Set();
console.log("\nDrafting the assessment from speech\n");
for (const c of cases) {
  const res = await fetch(`${BASE}/api/assessment/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript: c.text ?? fixtures[c.text_from_fixture] }),
  });
  const json = await res.json();
  if (!json.ok) {
    console.log(`${c.id}: ERROR ${json.code} ${json.message}`);
    continue;
  }
  sources.add(json.source);
  const d = json.draft;
  const wrong = [];
  for (const [field, exp] of Object.entries(c.expected)) {
    scored += 1;
    const got = d[field];
    let ok;
    if (exp === null) {
      ok = empty(got);
      if (!ok) invented += 1;
    } else if (field === "expertise_needs") ok = Array.isArray(got) && exp.every((n) => got.includes(n));
    else if (Array.isArray(exp)) ok = Array.isArray(got) && same(got, exp);
    else if (typeof exp === "string") ok = typeof got === "string" && got.toLowerCase() === exp.toLowerCase();
    else ok = got === exp;
    if (ok) correct += 1;
    else wrong.push(`${field}: expected ${JSON.stringify(exp)}, got ${JSON.stringify(got)}`);
  }
  const n = Object.keys(c.expected).length;
  console.log(`${c.id.padEnd(18)} ${String(n - wrong.length).padStart(2)}/${n} fields  (${json.source})`);
  for (const w of wrong) console.log(`${" ".repeat(19)}${w}`);
  if (PACE_MS > 0) await new Promise((r) => setTimeout(r, PACE_MS));
}
console.log(`\nOverall: ${Math.round((100 * correct) / Math.max(1, scored))}% of fields right, ${invented} invented answer(s). Sources: ${[...sources].join(", ")}.`);
