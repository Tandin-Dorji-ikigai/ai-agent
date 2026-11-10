#!/usr/bin/env node
// End-to-end check of the full 14-step demo against a running app.
//
//   npm run dev            (in one terminal)
//   npm run demo:e2e       (in another)
//
// Options (environment variables):
//   BASE_URL   default http://localhost:3000
//   RUNS       how many reset-to-finish runs to do, default 2
//
// WARNING: this resets the demo database at the start and end of every run.

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const RUNS = Number(process.env.RUNS ?? 2);

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail !== undefined ? `\n        ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
  }
}

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json;
  try {
    json = await res.json();
  } catch {
    json = { ok: false, code: "NON_JSON", message: await res.text() };
  }
  return { status: res.status, json };
}
const state = async () => (await call("GET", "/api/state")).json;

async function runOnce(n, fx) {
  console.log(`\nRun ${n}`);

  // Reset
  const reset = await call("POST", "/api/demo/reset");
  check("reset succeeds", reset.status === 200, reset.json);
  let s = await state();
  check("starts seeded, with no steps done", s.seeded && s.steps.every((x) => !x.done), s.steps);
  check("starts with Nu. 3,000 credit and no booking", s.credit?.amount_remaining === 3000 && !s.booking, s.credit);
  check("starts with the demo clock at +0 days", s.clock.offset_days === 0, s.clock);

  // 1. Assessment
  const a = await call("POST", "/api/assessment", fx.assessment);
  check("1  assessment saved and summarised", a.status === 200 && a.json.outcome?.status === "completed", a.json);

  // 2-4. Matching
  const m = await call("POST", "/api/matches");
  check("2  mentor scores calculated", m.status === 200 && m.json.outcome?.status === "completed", m.json);
  s = await state();
  check("3  three verified mentors returned", s.matches.length === 3 && s.matches.every((x) => x.mentor.verified && x.mentor.active), s.matches.length);
  check("   top match is Deki Wangmo (88)", s.matches[0]?.mentor.full_name === "Deki Wangmo" && s.matches[0]?.score === 88, s.matches[0]);
  check("4  every match has an explanation", s.matches.every((x) => x.explanation), s.matches.map((x) => x.explanation));
  check("   most-booked mentor is not in the top 3", s.most_booked && !s.matches.some((x) => x.mentor.id === s.most_booked.mentor.id), s.most_booked);

  // 5-8. Booking with YDF credit
  const key = `e2e-${n}-${Date.now()}`;
  const deki = fx.ids.mentors.dekiWangmo;
  const b1 = await call("POST", "/api/booking", { mentor_id: deki, funding_type: "ydf_credit", idempotency_key: key });
  check("5-7 booking created with YDF credit", b1.status === 200 && b1.json.booking_id, b1.json);
  const b2 = await call("POST", "/api/booking", { mentor_id: deki, funding_type: "ydf_credit", idempotency_key: key });
  check("   repeat request returns the same booking", b2.json.booking_id === b1.json.booking_id, b2.json);
  const b3 = await call("POST", "/api/booking", { mentor_id: deki, funding_type: "ydf_credit", idempotency_key: `${key}-other` });
  check("   second booking with the same mentor is refused", b3.status === 409 && b3.json.code === "BOOKING_ALREADY_ACTIVE", b3.json);
  s = await state();
  check("   credit deducted exactly once (3,000 -> 1,500)", s.credit?.amount_remaining === 1500, s.credit);
  check("8  entrepreneur and mentor briefs produced", !!s.booking?.entrepreneur_brief && !!s.booking?.mentor_brief, s.booking);

  // 9-10. Session notes and extraction
  const c1 = await call("POST", "/api/session/complete", { booking_id: b1.json.booking_id, notes: fx.session_notes });
  check("9  mentor notes submitted", c1.status === 200 && c1.json.outcome?.status === "completed", c1.json);
  const c2 = await call("POST", "/api/session/complete", { booking_id: b1.json.booking_id, notes: fx.session_notes });
  check("   repeat submit reuses the session, no second run", c2.json.session_id === c1.json.session_id && c2.json.outcome?.status === "skipped", c2.json);
  s = await state();
  const drafts = s.actions.filter((x) => x.status === "draft");
  check("10 three draft actions extracted", drafts.length === 3, s.actions);

  // 11. Human confirmation
  const ids = drafts.map((x) => x.id);
  const k1 = await call("POST", "/api/actions/confirm", { session_id: c1.json.session_id, action_ids: ids });
  check("11 human confirms the actions", k1.status === 200 && k1.json.actions?.length === 3 && k1.json.actions.every((x) => x.status === "pending"), k1.json);
  const msgsBefore = (await state()).messages.length;
  const k2 = await call("POST", "/api/actions/confirm", { session_id: c1.json.session_id, action_ids: ids });
  s = await state();
  check("   confirming twice changes nothing", k2.json.actions?.length === 3 && s.messages.length === msgsBefore, { k2: k2.json, msgsBefore, after: s.messages.length });

  // 12. Fast-forward
  const f = await call("POST", "/api/demo/fast-forward", { days: fx.fast_forward_days });
  check("12 fast-forward makes exactly one action overdue", f.status === 200 && f.json.overdue_action_ids?.length === 1, f.json);
  s = await state();
  const overdue = s.actions.find((x) => x.status === "overdue");
  check("   it is the permits action", overdue?.title === "Confirm which permits the guided village walk needs", overdue);
  const followUp = s.messages.find((x) => x.kind === "follow_up" && x.awaiting_reply);
  check("   agent asks about the blocker", !!followUp, s.messages.map((x) => x.kind));

  // 13. Reply and decision
  const r1 = await call("POST", "/api/inbox/reply", { message_id: followUp?.id, body: fx.blocker_reply });
  check("13 agent decides: escalate to YDF", r1.status === 200 && r1.json.outcome?.decision === "Escalate to YDF", r1.json);
  const r2 = await call("POST", "/api/inbox/reply", { message_id: followUp?.id, body: fx.blocker_reply });
  check("   a second reply cannot trigger a second decision", r2.status === 409 && r2.json.code === "ALREADY_ANSWERED", r2.json);

  // 14. Dashboard
  s = await state();
  check("14 one open escalation, ESC-101", s.escalations.length === 1 && s.escalations[0].code === "ESC-101" && s.escalations[0].status === "open", s.escalations);
  check(
    "   dashboard values come from the database",
    s.metrics.credits_used === 1500 && s.metrics.sessions_completed === 1 && s.metrics.actions_total === 3 && s.metrics.open_escalations === 1,
    s.metrics,
  );
  const decisionRun = s.runs.find((x) => x.trigger === "entrepreneur.blocked");
  check("   activity log shows decision factors and tools", decisionRun?.decision_factors?.length > 0 && decisionRun?.tools_called?.some((t) => t.tool === "create_escalation"), decisionRun);
  check("   all 14 steps are done", s.steps.every((x) => x.done), s.steps.filter((x) => !x.done));
  check("   no agent run failed", s.runs.every((x) => x.status === "completed"), s.runs.filter((x) => x.status !== "completed"));

  // Reset again (KEEP_END_STATE=1 leaves the last run finished, for inspection)
  if (process.env.KEEP_END_STATE === "1" && n === RUNS) return;
  const reset2 = await call("POST", "/api/demo/reset");
  s = await state();
  check(
    "reset restores the starting state",
    reset2.status === 200 && !s.booking && s.actions.length === 0 && s.escalations.length === 0 && s.messages.length === 0 && s.runs.length === 0 && s.clock.offset_days === 0 && s.credit?.amount_remaining === 3000,
    { booking: s.booking, actions: s.actions.length, escalations: s.escalations.length, offset: s.clock.offset_days },
  );
}

const fx = await (await fetch(`${BASE}/api/demo/fixtures`)).json();
for (let i = 1; i <= RUNS; i++) await runOnce(i, fx);
console.log(failures === 0 ? `\nAll checks passed (${RUNS} runs).` : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
