#!/usr/bin/env node
// Scores the agent's extraction against evals/extraction-cases.json.
//
//   npm run dev                  (AI_MODE=fixture scores the rule-based fallback,
//                                 AI_MODE=live scores the live AI)
//   npm run eval:extraction
//
// Options: BASE_URL (default http://localhost:3000), PACE_MS between cases
// (default 2000), ONLY=<case id>. Uses the dev-only /api/dev/extract route,
// which saves nothing. Results are written to evals/results/ (git-ignored).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PACE_MS = Number(process.env.PACE_MS ?? 2000);
const { cases } = JSON.parse(readFileSync(new URL("../evals/extraction-cases.json", import.meta.url), "utf8"));
const fixtures = await (await fetch(`${BASE}/api/demo/fixtures`)).json();

const textOf = (a) => `${a.title} ${a.description ?? ""} ${a.success_measure ?? ""}`;
const pad = (s, n) => String(s).padEnd(n);

const results = [];
for (const c of cases.filter((x) => !process.env.ONLY || x.id === process.env.ONLY)) {
  const text = c.text ?? fixtures[c.text_from_fixture];
  const res = await fetch(`${BASE}/api/dev/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, source: c.source }),
  });
  const json = await res.json();
  if (!json.ok) {
    console.log(`${c.id}: ERROR ${json.code} ${json.message}`);
    results.push({ id: c.id, error: json.code });
    continue;
  }
  const actions = json.extraction.actions;
  const used = new Set();
  let matched = 0, dueOk = 0, dueChecked = 0, ownerOk = 0, ownerChecked = 0;
  const misses = [];
  for (const exp of c.expected) {
    const regexes = exp.match.map((r) => new RegExp(r, "i"));
    const candidates = actions
      .map((a, i) => ({ a, i }))
      .filter(({ a, i }) => !used.has(i) && regexes.every((r) => r.test(textOf(a))));
    const pick = candidates.find(({ a }) => !exp.owner || a.owner === exp.owner) ?? candidates[0];
    if (!pick) {
      misses.push(exp.match.join(" + "));
      continue;
    }
    used.add(pick.i);
    matched += 1;
    if (exp.due !== undefined) {
      dueChecked += 1;
      if (Math.abs(pick.a.due_in_days - exp.due) <= 1) dueOk += 1;
    }
    if (exp.owner) {
      ownerChecked += 1;
      if (pick.a.owner === exp.owner) ownerOk += 1;
    }
  }
  const forbidden = actions.filter((a) => c.must_not.some((r) => new RegExp(r, "i").test(textOf(a))));
  const extras = actions.length - matched;
  results.push({
    id: c.id,
    expected: c.expected.length,
    extracted: actions.length,
    matched,
    extras,
    dueOk,
    dueChecked,
    ownerOk,
    ownerChecked,
    forbidden: forbidden.map((a) => a.title),
    misses,
    source: json.source,
    parts: json.parts,
    liveParts: json.liveParts,
    ms: json.ms,
    actions: actions.map((a) => ({ title: a.title, owner: a.owner, due_in_days: a.due_in_days })),
  });
  if (PACE_MS > 0) await new Promise((r) => setTimeout(r, PACE_MS));
}

const ok = results.filter((r) => !r.error);
const sum = (k) => ok.reduce((s, r) => s + r[k], 0);
const pct = (a, b) => (b === 0 ? "n/a" : `${Math.round((100 * a) / b)}%`);
const mode = ok[0] ? (ok.every((r) => r.source === "live_ai") ? "live AI" : ok.some((r) => r.source === "live_ai") ? "mixed (some saved rules)" : "rule-based fallback") : "unknown";

console.log(`\nExtraction quality (${mode})\n`);
console.log(`${pad("case", 24)}${pad("found", 9)}${pad("extra", 7)}${pad("due ok", 9)}${pad("owner ok", 10)}${pad("forbidden", 11)}parts  time`);
for (const r of results) {
  if (r.error) {
    console.log(`${pad(r.id, 24)}ERROR ${r.error}`);
    continue;
  }
  console.log(
    `${pad(r.id, 24)}${pad(`${r.matched}/${r.expected}`, 9)}${pad(r.extras, 7)}${pad(`${r.dueOk}/${r.dueChecked}`, 9)}${pad(`${r.ownerOk}/${r.ownerChecked}`, 10)}${pad(r.forbidden.length, 11)}${pad(`${r.liveParts}/${r.parts}`, 7)}${(r.ms / 1000).toFixed(1)}s`,
  );
  for (const m of r.misses) console.log(`${" ".repeat(24)}missed: ${m}`);
  for (const f of r.forbidden) console.log(`${" ".repeat(24)}FORBIDDEN: ${f}`);
}
console.log(
  `\nOverall: found ${pct(sum("matched"), sum("expected"))} of expected actions, ` +
    `${pct(sum("matched"), sum("extracted"))} of extracted actions were expected, ` +
    `due dates ${pct(sum("dueOk"), sum("dueChecked"))}, owners ${pct(sum("ownerOk"), sum("ownerChecked"))}, ` +
    `forbidden actions: ${ok.reduce((s, r) => s + r.forbidden.length, 0)}.`,
);

mkdirSync(new URL("../evals/results/", import.meta.url), { recursive: true });
const file = new URL(`../evals/results/${new Date().toISOString().replace(/[:.]/g, "-")}.json`, import.meta.url);
writeFileSync(file, JSON.stringify({ base: BASE, mode, results }, null, 2));
console.log(`Saved ${file.pathname.split("/").slice(-3).join("/")}`);
