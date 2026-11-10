#!/usr/bin/env node
// End-to-end check of the full 14-step demo against a running app.
//
//   npm run dev            (in one terminal)
//   npm run demo:e2e       (in another)
//
// Options (environment variables):
//   BASE_URL   default http://localhost:3000
//   RUNS       how many reset-to-finish runs to do, default 2
//   PACE_MS    pause after each action, e.g. 4000 with live AI to stay under
//              the free tier's tokens-per-minute limit (default 0)
//
// Works with AI_MODE=fixture (exact checks) and AI_MODE=live (wording may
// differ, so actions are found by keyword; a source summary is printed).
//
// WARNING: this resets the demo database at the start and end of every run.

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const RUNS = Number(process.env.RUNS ?? 2);
const PACE_MS = Number(process.env.PACE_MS ?? 0);

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
  if (method === "POST" && PACE_MS > 0) await new Promise((r) => setTimeout(r, PACE_MS));
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

  // 12. Fast-forward: the scheduling agent follows up and checks in
  const f = await call("POST", "/api/demo/fast-forward", { days: fx.fast_forward_days });
  check("12 fast-forward makes exactly one action overdue", f.status === 200 && f.json.overdue_action_ids?.length === 1, f.json);
  check("   and sends one scheduled check-in", f.json.check_in_action_ids?.length === 1, f.json);
  s = await state();
  const titleOf = (id) => s.actions.find((x) => x.id === id)?.title;
  const overdue = s.actions.find((x) => x.status === "overdue");
  check("   the overdue one is the permits action", /permit|licen/i.test(overdue?.title ?? ""), overdue);
  const followUp = s.messages.find((x) => x.kind === "follow_up" && x.awaiting_reply);
  const checkIn = s.messages.find((x) => x.kind === "check_in" && x.awaiting_reply);
  check("   agent asks about the blocker", !!followUp, s.messages.map((x) => x.kind));
  check("   agent checks in on the interviews before they are due", /interview|guest/i.test(titleOf(checkIn?.related_action_id) ?? ""), checkIn);

  // 13a. On track -> confirm next check-in
  const t1 = await call("POST", "/api/inbox/reply", { message_id: checkIn?.id, body: fx.on_track_reply });
  check("13 on-track reply: agent confirms the next check-in", t1.status === 200 && t1.json.outcome?.decision === "On track: confirm next check-in", t1.json);
  s = await state();
  check("   next check-in is scheduled", !!s.actions.find((x) => x.id === checkIn?.related_action_id)?.next_check_in_at, s.actions);

  // 13b. Stuck, needs help, agent cannot resolve -> human (YDF for permits)
  const r1 = await call("POST", "/api/inbox/reply", { message_id: followUp?.id, body: fx.blocker_reply });
  check("   stuck reply: agent decides to escalate to YDF", r1.status === 200 && r1.json.outcome?.decision === "Escalate to YDF", r1.json);
  const r2 = await call("POST", "/api/inbox/reply", { message_id: followUp?.id, body: fx.blocker_reply });
  check("   a second reply cannot trigger a second decision", r2.status === 409 && r2.json.code === "ALREADY_ANSWERED", r2.json);

  // 14. Dashboard and mentor progress
  s = await state();
  check("14 one open escalation, ESC-101", s.escalations.length === 1 && s.escalations[0].code === "ESC-101" && s.escalations[0].status === "open", s.escalations);
  check(
    "   dashboard values come from the database",
    s.metrics.credits_used === 1500 && s.metrics.sessions_completed === 1 && s.metrics.actions_total === 3 && s.metrics.open_escalations === 1,
    s.metrics,
  );
  const decisionRun = s.runs.find((x) => x.trigger === "checkin.replied" && x.decision === "Escalate to YDF");
  check("   activity log shows decision factors and tools", decisionRun?.decision_factors?.length > 0 && decisionRun?.tools_called?.some((t) => t.tool === "create_escalation"), decisionRun);
  check("   mentor progress has the on-track and escalated updates", ["on_track", "escalated"].every((k) => s.progress.some((p) => p.kind === k)), s.progress);
  check("   next-session agenda leads with the escalation", s.agenda[0]?.kind === "escalated" && s.agenda[0]?.text.includes("ESC-101"), s.agenda);
  check("   all 14 steps are done", s.steps.every((x) => x.done), s.steps.filter((x) => !x.done));

  // Remaining workflow branches: record obstacle, mark done, next session
  const f2 = await call("POST", "/api/demo/fast-forward", { days: fx.fast_forward_days });
  check("   second fast-forward: interviews and positioning now overdue", f2.json.overdue_action_ids?.length === 2, f2.json);
  s = await state();
  const waiting = s.messages.filter((x) => x.awaiting_reply);
  const msgFor = (re) => waiting.find((x) => re.test(titleOf(x.related_action_id) ?? ""));
  const o1 = await call("POST", "/api/inbox/reply", { message_id: msgFor(/interview|guest/i)?.id, body: fx.obstacle_reply });
  check("   'sick, will catch up' reply: agent records the obstacle", o1.json.outcome?.decision === "Record obstacle", o1.json);
  const d1 = await call("POST", "/api/inbox/reply", { message_id: msgFor(/position|statement/i)?.id, body: fx.done_reply });
  check("   'done' reply: agent marks the action done", d1.json.outcome?.decision === "Mark done", d1.json);
  s = await state();
  check("   dashboard shows 1 of 3 actions completed", s.metrics.actions_completed === 1 && s.metrics.actions_total === 3, s.metrics);
  check("   agenda includes the obstacle and the done action", s.agenda.some((a) => a.kind === "obstacle") && s.agenda.some((a) => a.kind === "done"), s.agenda);

  const nb = await call("POST", "/api/booking", { mentor_id: deki, funding_type: "ydf_credit", idempotency_key: `${key}-followup` });
  s = await state();
  check("   next session: follow-up booked with YDF credit", nb.status === 200 && s.credit?.amount_remaining === 0, { nb: nb.json, credit: s.credit });
  check(
    "   follow-up brief is built from progress",
    s.ai_mode === "live"
      ? (s.booking?.mentor_brief?.focus?.length ?? 0) > 0 && s.booking?.id !== b1.json.booking_id
      : s.booking?.mentor_brief?.headline?.startsWith("Follow-up session") && s.booking.mentor_brief.focus.some((x) => x.includes("ESC-101")),
    s.booking?.mentor_brief,
  );
  if (s.ai_mode === "live") {
    const bySource = {};
    for (const r of s.runs) if (r.source) bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    const fallbacks = s.runs.filter((r) => r.source === "fallback").map((r) => r.trigger);
    console.log(`  info  agent runs by source: ${JSON.stringify(bySource)}${fallbacks.length ? `; saved responses used for: ${fallbacks.join(", ")}` : ""}`);
  }
  check("   no agent run failed", s.runs.every((x) => x.status === "completed"), s.runs.filter((x) => x.status !== "completed"));

  // Reset again (KEEP_END_STATE=1 leaves the last run finished, for inspection)
  if (process.env.KEEP_END_STATE === "1" && n === RUNS) return;
  const reset2 = await call("POST", "/api/demo/reset");
  s = await state();
  check(
    "reset restores the starting state",
    reset2.status === 200 && !s.booking && s.actions.length === 0 && s.escalations.length === 0 && s.messages.length === 0 && s.runs.length === 0 && s.progress.length === 0 && s.clock.offset_days === 0 && s.credit?.amount_remaining === 3000,
    { booking: s.booking, actions: s.actions.length, escalations: s.escalations.length, offset: s.clock.offset_days },
  );
}

const fx = await (await fetch(`${BASE}/api/demo/fixtures`)).json();
for (let i = 1; i <= RUNS; i++) await runOnce(i, fx);
console.log(failures === 0 ? `\nAll checks passed (${RUNS} runs).` : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
