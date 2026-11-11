#!/usr/bin/env node
// End-to-end check of the full 14-step demo against a running app, plus the
// mentor-request branches (decline, no reply, hand-over to YDF).
//
//   npm run dev            (in one terminal)
//   npm run demo:e2e       (in another)
//
// Options (environment variables):
//   BASE_URL   default http://localhost:3000
//   RUNS       how many reset-to-finish runs to do, default 2
//   E2E_SOURCE typed (default), call (the session as a call: each person's
//              microphone uploaded and merged), or call_recording: send the sample call
//              transcript instead of typed notes (handover contract test)
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
const VIA_CALL = process.env.E2E_SOURCE === "call_recording";
// E2E_SOURCE=call: the session happens as a call; each person's microphone is
// uploaded separately and merged into a transcript with certain speakers.
const VIA_TRACKS = process.env.E2E_SOURCE === "call";

/** A tiny valid WAV (silence): with AI_MODE=fixture the server uses the saved demo recordings. */
function tinyWav() {
  const samples = 1600;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + samples * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, samples * 2, true);
  return new Blob([buf], { type: "audio/wav" });
}

async function upload(fields, file = tinyWav(), name = "track.wav") {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  form.append("file", file, name);
  const res = await fetch(`${BASE}/api/calls/track`, { method: "POST", body: form });
  return { status: res.status, json: await res.json() };
}

/** The session as a call: join (which starts recording), stop and restart it, upload each microphone, end. Returns the final /api/calls/end response. */
async function callSession(bookingId) {
  const jE = await call("POST", "/api/calls/join", { booking_id: bookingId, role: "entrepreneur" });
  const early = await upload({ call_id: jE.json.call_id, role: "entrepreneur", part: 0, started_at_ms: jE.json.server_time_ms });
  check("   call: nothing is recorded while only one person is in", early.status === 409 && early.json.code === "RECORDING_NOT_ALLOWED", early.json);
  check("   call: the first one in triggers a notification to the other", jE.json.notify_other === true, jE.json);
  const jM = await call("POST", "/api/calls/join", { booking_id: bookingId, role: "mentor" });
  check("9  call: both join the same room for the confirmed booking", jE.status === 200 && jM.json.call_id === jE.json.call_id, { jE: jE.json, jM: jM.json });
  check("   call: a personal pass only when a video provider is set up", jE.json.provider === "livekit" ? !!jE.json.livekit?.token : jE.json.livekit === null, jE.json);
  const callId = jE.json.call_id;
  check("   call: recording starts on its own once both have joined (joining = agreeing)", jM.json.recording?.allowed === true, jM.json);
  check("   call: joining second notifies nobody", jM.json.notify_other === false, jM.json);
  const stop = await call("POST", "/api/calls/consent", { call_id: callId, role: "mentor", consent: false });
  check("   call: either person can stop the recording", stop.json.recording?.allowed === false, stop.json);
  const rejoin = await call("POST", "/api/calls/join", { booking_id: bookingId, role: "mentor" });
  check("   call: rejoining does not switch a stopped recording back on", rejoin.json.recording?.allowed === false, rejoin.json);
  check("   call: rejoining notifies nobody", rejoin.json.notify_other === false, rejoin.json);
  const cM = await call("POST", "/api/calls/consent", { call_id: callId, role: "mentor", consent: true });
  check("   call: Record again turns it back on", cM.json.recording?.allowed === true, cM.json);
  const mov = await upload({ call_id: callId, role: "mentor", part: 0, started_at_ms: jM.json.server_time_ms }, new Blob(["x"], { type: "video/quicktime" }), "clip.mov");
  check("   call: formats Groq rejects are refused before upload", mov.status === 400 && mov.json.code === "UNSUPPORTED_FORMAT", mov.json);
  const start = jM.json.server_time_ms;
  const uM = await upload({ call_id: callId, role: "mentor", part: 0, started_at_ms: start });
  const uE = await upload({ call_id: callId, role: "entrepreneur", part: 0, started_at_ms: start });
  check("   call: each person's microphone uploaded and transcribed", uM.status === 200 && uE.status === 200 && uM.json.segments > 0 && uE.json.segments > 0, { uM: uM.json, uE: uE.json });
  const again = await upload({ call_id: callId, role: "mentor", part: 0, started_at_ms: start });
  check("   call: uploading the same part again is safe", again.json.reused === true && again.json.part_id === uM.json.part_id, again.json);
  const eE = await call("POST", "/api/calls/end", { call_id: callId, role: "entrepreneur" });
  check("   call: waits for the mentor to finish too", eE.json.finalized === false && eE.json.waiting_for === "mentor", eE.json);
  const eM = await call("POST", "/api/calls/end", { call_id: callId, role: "mentor" });
  check("   call ends: transcript with certain speakers goes to the agent", eM.status === 200 && eM.json.finalized && eM.json.transcript_turns >= 2 && eM.json.outcome?.status === "completed", eM.json);
  const late = await call("POST", "/api/calls/join", { booking_id: bookingId, role: "entrepreneur" });
  check("   call: the room is closed once the session is complete", late.status === 409 && late.json.code === "CALL_ENDED", late.json);
  return eM;
}

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

  // Voice intro -> draft of the assessment (saves nothing)
  const vd = await call("POST", "/api/assessment/draft", { transcript: fx.voice_intro });
  check(
    "   voice intro drafts the form (sector, budget, needs)",
    vd.status === 200 && vd.json.draft?.sector === "tourism" && vd.json.draft?.budget === 1500 && vd.json.draft?.expertise_needs?.includes("pricing"),
    vd.json,
  );
  const va = await call("POST", "/api/assessment/draft", { transcript: fx.aspiring_intro });
  check(
    "   aspiring intro: idea stage, finding an idea, asks only budget and language",
    va.status === 200 &&
      va.json.draft?.business_stage === "idea" &&
      va.json.draft?.expertise_needs?.includes("idea_development") &&
      ["budget", "preferred_language"].every((f) => va.json.missing?.includes(f)) &&
      !va.json.draft?.business_name &&
      va.json.draft?.budget === undefined,
    va.json,
  );
  s = await state();
  check("   drafting saved nothing", !s.entrepreneur?.assessment_completed_at, s.entrepreneur);

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

  // 5-8. The agent asks the best match; the mentor decides and picks a time
  const deki = fx.ids.mentors.dekiWangmo;
  const asked = s.pending_request;
  check(
    "5  agent asks the best match (Deki); nothing booked or paid yet",
    asked?.mentor.id === deki && asked.status === "pending" && asked.attempt === 1 && !s.booking && s.credit?.amount_remaining === 3000,
    { asked, booking: s.booking, credit: s.credit },
  );
  check("   the request offers Deki's own times, paid with YDF credit", asked?.offered_slots.length >= 1 && asked.funding_type === "ydf_credit", asked);
  check(
    "   Deki sees needs and why, not a phone number or budget",
    asked?.mentee_summary.needs.length === 3 &&
      asked.mentee_summary.why.length > 0 &&
      !Object.keys(asked.mentee_summary).some((k) => /budget|phone/.test(k)) &&
      !/1,?500|Nu\./.test(JSON.stringify(asked.mentee_summary)),
    asked?.mentee_summary,
  );
  check(
    "   the needs extras are saved and shown to the mentor (done so far, when, how to meet)",
    s.entrepreneur?.progress_so_far === fx.assessment.progress_so_far && s.entrepreneur?.timeframe === fx.assessment.timeframe &&
      asked?.mentee_summary.progress_so_far === fx.assessment.progress_so_far && asked?.mentee_summary.timeframe === fx.assessment.timeframe &&
      asked?.mentee_summary.mentoring_format === fx.assessment.mentoring_format,
    { entrepreneur: s.entrepreneur, summary: asked?.mentee_summary },
  );
  check(
    "   Pema is told who was asked, and Sonam is next",
    s.messages.some((x) => /asked Deki Wangmo/.test(x.body)) && s.request_round?.next_mentor?.mentor.full_name === "Sonam Choden",
    { messages: s.messages.map((x) => x.body), next: s.request_round?.next_mentor },
  );
  check("   the mentor view shows Deki with the request", s.mentor_for_view?.id === deki, s.mentor_for_view);
  const st1 = await call("POST", "/api/requests/start");
  check("   auto-start does nothing while Deki is deciding", st1.status === 200 && st1.json.started === false && st1.json.reason === "already_asked", st1.json);
  const badSlot = await call("POST", "/api/requests/accept", { request_id: asked?.id, scheduled_at: "2030-01-01T04:00:00.000Z" });
  check("   accepting a time Deki did not offer is refused", badSlot.status === 409 && badSlot.json.code === "SLOT_NOT_OFFERED", badSlot.json);
  const slot = asked?.offered_slots[0];
  const b1 = await call("POST", "/api/requests/accept", { request_id: asked?.id, scheduled_at: slot });
  check("6  Deki accepts and picks a time", b1.status === 200 && b1.json.booking_id && b1.json.outcome?.status === "completed", b1.json);
  const b2 = await call("POST", "/api/requests/accept", { request_id: asked?.id, scheduled_at: slot });
  check("   accepting twice returns the same booking", b2.json.booking_id === b1.json.booking_id && b2.json.outcome?.status === "skipped", b2.json);
  const late = await call("POST", "/api/requests/decline", { request_id: asked?.id, reason: "no_time" });
  check("   an accepted request cannot then be declined", late.status === 409 && late.json.code === "REQUEST_NOT_PENDING", late.json);
  s = await state();
  check(
    "7  booked at Deki's chosen time with YDF credit (3,000 -> 1,500, once)",
    s.booking?.funding_type === "ydf_credit" && new Date(s.booking.scheduled_at).getTime() === new Date(slot).getTime() && s.credit?.amount_remaining === 1500,
    { booking: s.booking, credit: s.credit },
  );
  check("   Pema is told Deki accepted, with the time", s.messages.some((x) => /Deki Wangmo accepted your request/.test(x.body)), s.messages.map((x) => x.body));
  check("   the request round shows accepted", s.request_round?.status === "accepted" && !s.pending_request, s.request_round);
  const st2 = await call("POST", "/api/requests/start");
  check("   auto-start does nothing once a session is booked", st2.json.started === false && st2.json.reason === "booked", st2.json);
  check("8  entrepreneur and mentor briefs produced", !!s.booking?.entrepreneur_brief && !!s.booking?.mentor_brief, s.booking);

  // Handover contract: validation before anything is saved
  const bad1 = await call("POST", "/api/session/complete", { booking_id: b1.json.booking_id });
  check("   contract: notes or transcript required", bad1.status === 400 && bad1.json.code === "INVALID_INPUT", bad1.json);
  const bad2 = await call("POST", "/api/session/complete", {
    booking_id: b1.json.booking_id,
    transcript: "word ".repeat(42_000),
    source: "call_recording",
  });
  check("   contract: transcripts over the hard cap are refused", bad2.status === 400 && bad2.json.code === "INVALID_INPUT", bad2.json);

  // 9-10. Session notes (or call transcript, or a call) and extraction
  const completeBody = VIA_CALL
    ? { booking_id: b1.json.booking_id, transcript: fx.call_transcript, source: "call_recording" }
    : { booking_id: b1.json.booking_id, notes: fx.session_notes };
  let c1;
  if (VIA_TRACKS) {
    c1 = await callSession(b1.json.booking_id);
    const c2 = await call("POST", "/api/calls/end", { call_id: c1.json.call_id, role: "mentor" });
    check("   ending again changes nothing, no second run", c2.json.finalized === true && !c2.json.outcome, c2.json);
    s = await state();
    check(
      "   the session keeps the merged transcript; one part from each person",
      s.session?.transcript_chars > 0 && s.call?.transcript_built === true && s.call.parts.mentor === 1 && s.call.parts.entrepreneur === 1 && s.call.status === "ended",
      { session: s.session, call: s.call },
    );
  } else {
    c1 = await call("POST", "/api/session/complete", completeBody);
    check(`9  mentor ${VIA_CALL ? "call transcript" : "notes"} submitted`, c1.status === 200 && c1.json.outcome?.status === "completed", c1.json);
    const c2 = await call("POST", "/api/session/complete", completeBody);
    check("   repeat submit reuses the session, no second run", c2.json.session_id === c1.json.session_id && c2.json.outcome?.status === "skipped", c2.json);
  }
  s = await state();
  check("   session records where the text came from", s.session?.notes_source === (VIA_CALL || VIA_TRACKS ? "call_recording" : "typed"), s.session);
  const drafts = s.actions.filter((x) => x.status === "draft");
  check("10 three draft actions extracted", drafts.length === 3, s.actions);
  check("   the agent writes a recap: what was discussed and achieved", s.sessions_history[0]?.id === s.session?.id && s.sessions_history[0].recap?.discussed.length > 0, s.sessions_history);

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

  const fr = await call("POST", "/api/requests/ask", { mentor_id: deki });
  s = await state();
  const fq = s.pending_request;
  check(
    "   next session: the agent asks Deki for a follow-up",
    fr.status === 200 && fq?.mentor.id === deki && fq.kind === "direct" && fq.mentee_summary.follow_up === true,
    { fr: fr.json, fq },
  );
  const fa = await call("POST", "/api/requests/accept", { request_id: fq?.id, scheduled_at: fq?.offered_slots[0] });
  s = await state();
  check("   Deki accepts; the follow-up uses the rest of the YDF credit", fa.status === 200 && s.credit?.amount_remaining === 0, { fa: fa.json, credit: s.credit });
  check(
    "   follow-up brief is built from progress",
    s.ai_mode === "live"
      ? (s.booking?.mentor_brief?.focus?.length ?? 0) > 0 && s.booking?.id !== b1.json.booking_id
      : s.booking?.mentor_brief?.headline?.startsWith("Follow-up session") && s.booking.mentor_brief.focus.some((x) => x.includes("ESC-101")),
    s.booking?.mentor_brief,
  );
  // Long call: read in the background, in parts
  const followUpBooking = s.booking;
  const lt = await call("POST", "/api/session/complete", {
    booking_id: followUpBooking?.id,
    transcript: fx.long_call_transcript,
    source: "call_recording",
  });
  check("   long call transcript accepted for background reading", lt.status === 202 && lt.json.processing === true, lt.json);
  let longDrafts = [];
  let longRun;
  for (let t = 0; t < 120; t++) {
    await new Promise((r) => setTimeout(r, 2000));
    s = await state();
    longDrafts = s.actions.filter((a) => a.session_id === s.session?.id && a.status === "draft");
    longRun = s.runs.find((r) => r.trigger === "session.completed");
    if (longRun && longRun.status !== "running") break;
  }
  check("   long transcript: draft actions extracted in the background", longDrafts.length >= 3, { run: longRun, drafts: longDrafts });
  check(
    "   long transcript: the idea they decided against is not an action",
    // An action ABOUT building a website (a description may mention it as context).
    !longDrafts.some((a) => /website/i.test(a.title)),
    longDrafts.map((a) => `${a.title} | ${a.description ?? ""}`),
  );
  check("   long transcript was read in parts", /-part transcript/.test(longRun?.final_output ?? ""), longRun?.final_output);

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
    reset2.status === 200 && !s.booking && !s.request_round && s.actions.length === 0 && s.escalations.length === 0 && s.messages.length === 0 && s.runs.length === 0 && s.progress.length === 0 && s.clock.offset_days === 0 && s.credit?.amount_remaining === 3000,
    { booking: s.booking, actions: s.actions.length, escalations: s.escalations.length, offset: s.clock.offset_days },
  );
}

// The other branches of the request loop: decline, no reply, YDF hand-over, starting again.
async function declineRun(fx) {
  console.log("\nMentor says no, or does not reply");
  await call("POST", "/api/demo/reset");
  await call("POST", "/api/assessment", fx.assessment);
  await call("POST", "/api/matches");
  let s = await state();
  const first = s.pending_request;
  check("   Deki is asked first", first?.mentor.full_name === "Deki Wangmo" && first.attempt === 1, first);

  const d1 = await call("POST", "/api/requests/decline", { request_id: first?.id, reason: "no_time", note: "Travelling for the tshechu." });
  check("   Deki declines (no time): the agent asks Sonam next", d1.status === 200 && d1.json.outcome?.decision === "Ask Sonam Choden next", d1.json);
  const d1b = await call("POST", "/api/requests/decline", { request_id: first?.id, reason: "no_time" });
  check("   declining twice does not ask another mentor", d1b.status === 200 && d1b.json.outcome?.status === "skipped", d1b.json);
  s = await state();
  check(
    "   Pema is told why and who is next, without Deki's private note",
    s.messages.some((x) => /Deki has no time.*Sonam Choden/.test(x.body)) && !s.messages.some((x) => /tshechu/i.test(x.body)),
    s.messages.map((x) => x.body),
  );
  check("   still nothing booked or paid", !s.booking && s.credit?.amount_remaining === 3000, { booking: s.booking, credit: s.credit });
  check("   the mentor view now shows Sonam's request", s.mentor_for_view?.full_name === "Sonam Choden" && s.pending_request?.attempt === 2, s.pending_request);

  const ff = await call("POST", "/api/demo/fast-forward", { days: 3 });
  check("   Sonam does not reply in 2 days: the request expires", ff.status === 200 && ff.json.expired_request_count === 1, ff.json);
  s = await state();
  check(
    "   the agent asks Ugyen third, the last before YDF",
    s.pending_request?.mentor.full_name === "Ugyen Lhendup" && s.pending_request.attempt === 3 && !s.request_round?.next_mentor,
    s.request_round,
  );

  const d3 = await call("POST", "/api/requests/decline", { request_id: s.pending_request?.id, reason: "not_my_area" });
  check("   after three mentors, the agent hands over to YDF", d3.json.outcome?.decision === "Hand over to YDF", d3.json);
  s = await state();
  check(
    "   the YDF escalation lists who was asked and why",
    s.escalations[0]?.reason === "no_mentor_available" &&
      /Deki Wangmo \(no time this week\).*Sonam Choden \(no reply\).*Ugyen Lhendup \(not my area\)/.test(s.escalations[0].summary),
    s.escalations,
  );
  check("   Pema sees the request is with YDF", s.request_round?.status === "escalated" && s.request_round.escalation_code === s.escalations[0]?.code, s.request_round);
  const st3 = await call("POST", "/api/requests/start");
  check("   auto-start does not ask again while YDF is handling it", st3.json.started === false && st3.json.reason === "with_ydf", st3.json);
  check("   still nothing booked or paid", !s.booking && s.credit?.amount_remaining === 3000, s.credit);

  await call("POST", "/api/matches");
  s = await state();
  const fresh = s.pending_request;
  check("   matching again starts a new round with Deki", fresh?.mentor.full_name === "Deki Wangmo" && s.request_round?.requests.length === 1, s.request_round);
  await call("POST", "/api/matches");
  s = await state();
  check(
    "   changing answers replaces the open request (never two open)",
    !!s.pending_request && s.pending_request.id !== fresh?.id && s.request_round?.requests.length === 1,
    s.request_round,
  );
  check("   no agent run failed", s.runs.every((x) => x.status === "completed"), s.runs.filter((x) => x.status !== "completed"));
  if (process.env.KEEP_END_STATE !== "1") await call("POST", "/api/demo/reset");
}

/** No business idea yet: four beginner-coach steps, then the usual mentor request with what was found. */
// A casual talk where nothing concrete was agreed: no actions to confirm, so
// the follow-up opens straight away; the session still gets a recap and the
// whole conversation for both people.
async function noActionsRun(fx) {
  console.log("\nA casual talk with no agreed actions: recap, transcript, then a follow-up");
  await call("POST", "/api/demo/reset");
  await call("POST", "/api/assessment", fx.assessment);
  await call("POST", "/api/matches");
  await call("POST", "/api/requests/start");
  let s = await state();
  const asked = s.pending_request;
  const b = await call("POST", "/api/requests/accept", { request_id: asked?.id, scheduled_at: asked?.offered_slots[0] });
  const before = (await state()).messages.length;
  const transcript = [
    "[Mentor] Hello. How are you feeling about starting your entrepreneurship journey?",
    "[Entrepreneur] Excited but also confused. I have no clear business idea yet.",
    "[Mentor] Visitors already pass through your village. I suggest you try community tourism. We can talk again in two weeks.",
    "[Entrepreneur] I like the idea of village walks with local food. That makes me feel more confident.",
  ].join("\n");
  const done = await call("POST", "/api/session/complete", { booking_id: b.json.booking_id, transcript, source: "call_recording" });
  s = await state();
  check(
    "   casual talk: the agent finishes with a summary and no actions to confirm",
    done.status === 200 && !!s.session?.agent_summary && s.actions.length === 0 && s.session.summary_confirmed === false,
    { session: s.session, actions: s.actions },
  );
  check(
    "   the mentee is told once that a follow-up can be asked for",
    s.messages.length === before + 1 && s.messages.some((m) => /ask your mentor for a follow-up session/.test(m.body)),
    { before, after: s.messages.length },
  );
  const h = s.sessions_history[0];
  check(
    "   the session history has it, with a recap of what was discussed",
    s.sessions_history.length === 1 && h?.id === s.session.id && h.recap?.discussed.length > 0 && Array.isArray(h.recap.achieved) && h.transcript_chars > 0,
    s.sessions_history,
  );
  const inTwoWeeks = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Thimphu", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.parse(s.clock.now) + 14 * 864e5));
  check(
    "   the summary gives the mentor's main advice, a next step, and the follow-up they agreed (two weeks)",
    h?.recap?.advice?.length > 0 && typeof h.recap.next_step === "string" && h.recap.follow_up_on === inTwoWeeks && !!h.recap.follow_up_reason,
    h?.recap,
  );
  check(
    "   the mentee's message has the next step and when to meet again",
    s.messages.some((m) => /Suggested next step: .+\. A follow-up around \w{3} \d{1,2} \w{3} would be a good time/.test(m.body)),
    s.messages.at(-1)?.body,
  );
  const t = await call("GET", `/api/session/transcript?session_id=${s.session.id}`);
  check(
    "   both people can read the whole conversation, turn by turn",
    t.status === 200 && t.json.turns?.length === 4 && t.json.turns[0].speaker === "mentor" && t.json.turns[1].speaker === "entrepreneur",
    t.json,
  );
  const r = await call("POST", "/api/session/recap", { session_id: s.session.id });
  check("   asking for the recap again reuses it", r.status === 200 && r.json.reused === true, r.json);
  await call("POST", "/api/actions/confirm", { session_id: done.json.session_id, action_ids: [] });
  check("   confirming with nothing to confirm sends no second message", (await state()).messages.length === before + 1);
  const fr = await call("POST", "/api/requests/ask", { mentor_id: asked?.mentor.id });
  s = await state();
  check(
    "   the mentee asks the same mentor for a follow-up straight away",
    fr.status === 200 && s.pending_request?.mentor.id === asked?.mentor.id && s.pending_request.mentee_summary.follow_up === true,
    { fr: fr.json, pending: s.pending_request },
  );

  // The mentor says no to the follow-up: the mentee is told, and nobody else is asked without their say.
  const msgs = s.messages.length;
  const no = await call("POST", "/api/requests/decline", { request_id: s.pending_request.id, reason: "no_time", note: "Busy this week." });
  s = await state();
  check(
    "   follow-up declined: no other mentor is asked behind the mentee's back",
    no.status === 200 && !s.pending_request && s.request_round?.status === "declined" && s.request_round.requests.length === 1,
    { no: no.json, round: s.request_round },
  );
  check(
    "   the mentee is told why, and that they can ask again or ask another mentor",
    s.messages.length === msgs + 1 && s.messages.some((m) => /cannot take your follow-up session right now \(no time this week\)\. \w+ wrote: "Busy this week\."/.test(m.body)),
    s.messages.slice(-2).map((m) => m.body),
  );
  const other = s.matches.map((m) => m.mentor).find((m) => m.id !== asked?.mentor.id && m.slots_remaining > 0);
  const alt = await call("POST", "/api/requests/ask", { mentor_id: other?.id });
  s = await state();
  check("   then the mentee can ask another mentor instead", alt.status === 200 && s.pending_request?.mentor.id === other?.id, { alt: alt.json, pending: s.pending_request });
}

// What broke a real call: someone left (or tapped back) while alone, so they
// were marked finished; the other person joining later must not end the call,
// and a call that ended with nothing recorded must open again.
async function callRejoinRun(fx) {
  console.log("\nCalls: leaving and coming back, and a call that ended with nothing recorded");
  await call("POST", "/api/demo/reset");
  await call("POST", "/api/assessment", fx.assessment);
  await call("POST", "/api/matches");
  await call("POST", "/api/requests/start");
  let s = await state();
  const b = await call("POST", "/api/requests/accept", { request_id: s.pending_request.id, scheduled_at: s.pending_request.offered_slots[0] });
  const bookingId = b.json.booking_id;
  const j1 = await call("POST", "/api/calls/join", { booking_id: bookingId, role: "mentor" });
  await call("POST", "/api/calls/end", { call_id: j1.json.call_id, role: "mentor" });
  s = await state();
  check("   the mentor leaves while alone: marked finished, the call stays open", s.call?.status === "open" && s.call.done.mentor === true, s.call);
  await call("POST", "/api/calls/join", { booking_id: bookingId, role: "mentor" });
  s = await state();
  check("   rejoining clears the mentor's finished flag", s.call?.status === "open" && s.call.done.mentor === false && s.call.joined.mentor === true, s.call);
  await call("POST", "/api/calls/end", { call_id: j1.json.call_id, role: "mentor" });
  const je = await call("POST", "/api/calls/join", { booking_id: bookingId, role: "entrepreneur" });
  s = await state();
  check("   the mentee can still join after the mentor left", je.status === 200 && s.call?.status === "open", { je: je.json, call: s.call });
  check("   the mentor is away, so they are told the mentee has arrived", je.json.notify_other === true, je.json);
  const alone = await upload({ call_id: je.json.call_id, role: "entrepreneur", part: 0, started_at_ms: je.json.server_time_ms });
  check(
    "   the mentee alone is not recorded (they were never in the call together)",
    alone.status === 409 && alone.json.code === "RECORDING_NOT_ALLOWED",
    alone.json,
  );
  const ee = await call("POST", "/api/calls/end", { call_id: je.json.call_id, role: "entrepreneur" });
  s = await state();
  check(
    "   both finished with nothing recorded: the call ends but the booking stays confirmed",
    ee.json.finalized === true && s.call?.status === "ended" && s.booking?.status === "confirmed",
    { ee: ee.json, call: s.call, booking: s.booking?.status },
  );
  const again = await call("POST", "/api/calls/join", { booking_id: bookingId, role: "entrepreneur" });
  s = await state();
  check(
    "   joining again opens it as a fresh call (the session can still happen)",
    again.status === 200 && again.json.call_id === je.json.call_id && s.call?.status === "open" &&
      s.call.joined.entrepreneur === true && s.call.joined.mentor === false && s.call.done.mentor === false && s.call.done.entrepreneur === false,
    { again: again.json, call: s.call },
  );
}

async function coachRun(fx) {
  console.log("\nNo idea yet: the beginner coach, then a mentor");
  await call("POST", "/api/demo/reset");
  const explorer = {
    ...fx.assessment,
    business_name: "",
    business_stage: "idea",
    sector: "agriculture",
    business_description: "I like growing food and talking with people in my village.",
    primary_challenge: "I need help finding and validating a business idea.",
    goals: [],
    expertise_needs: ["idea_development"],
    budget: 0,
  };
  const saved = await call("POST", "/api/assessment", explorer);
  check("   saves the needs of someone with no idea yet", saved.json.ok === true, saved.json);
  await call("POST", "/api/matches");
  let s = await state();
  check("   matches are saved, but no mentor is asked before the coach", s.matches.length > 0 && !s.pending_request, { matches: s.matches.length, pending: s.pending_request });
  const auto = await call("POST", "/api/requests/start");
  check("   auto-start waits for the coach too", auto.json.started === false && auto.json.reason === "coach_first", auto.json);

  await call("POST", "/api/coach/start");
  s = await state();
  check("8a coach: step 1 is written for this person", s.coach?.status === "active" && s.coach.steps[0]?.status === "open" && s.coach.steps[0].mission.length > 20, s.coach);
  await call("POST", "/api/coach/start");
  s = await state();
  check("   starting twice does not repeat step 1", s.coach.steps.length === 1, s.coach.steps);
  await call("POST", "/api/coach/reply", { step: 1, reply: "Some problems." });
  s = await state();
  check("   a thin report gets feedback and the step stays open", s.coach.steps[0].status === "open" && s.coach.steps[0].attempts === 1 && !!s.coach.steps[0].feedback, s.coach.steps[0]);
  const early = await call("POST", "/api/coach/reply", { step: 2, reply: "Jumping ahead." });
  check("   a report for a step that is not open is refused", early.status === 409 && early.json.code === "STEP_NOT_OPEN", early.json);

  const reports = [
    "Farmers near Lobesa lose tomatoes before the Sunday market. Shop owners in Punakha run out of fresh milk. Students wait a long time for the bus.",
    "I asked three farmers. Two said they lose about Nu. 300 of tomatoes a week because nothing stays cool. One said it is not a problem.",
    "A shared cold box at the market. Farmers would pay about Nu. 100 a week to keep vegetables fresh.",
    "I asked five farmers. Two paid a Nu. 100 deposit and one wants to try it next month.",
  ];
  for (let i = 0; i < reports.length; i++) {
    s = await state();
    const open = s.coach.steps.find((x) => x.status === "open");
    // Live AI may ask for more on a step: answer again (it moves on by the third try).
    for (let t = 0; t < 3 && open && s.coach.steps.find((x) => x.step === open.step)?.status === "open"; t++) {
      await call("POST", "/api/coach/reply", { step: open.step, reply: reports[open.step - 1] });
      s = await state();
    }
  }
  check("8b coach: all four steps done, with what they found", s.coach?.status === "ready" && s.coach.steps.length === 4 && s.coach.steps.every((x) => x.status === "done") && s.coach.steps[1].learnings.length > 0, s.coach);
  check("   a readiness summary for the mentor", !!s.coach.summary?.idea && s.coach.summary.evidence.length > 0 && s.coach.summary.questions_for_mentor.length > 0, s.coach.summary);
  check("8c then the agent asks a mentor (the usual request)", !!s.pending_request && s.pending_request.attempt === 1, s.pending_request);
  await call("POST", "/api/requests/accept", { request_id: s.pending_request?.id, scheduled_at: s.pending_request?.offered_slots[0] });
  s = await state();
  check("   the mentor's brief starts from what the coach found", /cold box/i.test(JSON.stringify(s.booking?.mentor_brief ?? {})), s.booking?.mentor_brief);
  check("   the coach's work shows in the agent log", s.runs.some((r) => r.trigger === "coach.started") && s.runs.filter((r) => r.trigger === "coach.replied").length >= 5, s.runs.map((r) => r.trigger));
  check("   no agent run failed", s.runs.every((x) => x.status === "completed"), s.runs.filter((x) => x.status !== "completed"));

  await call("POST", "/api/demo/reset");
  await call("POST", "/api/assessment", explorer);
  await call("POST", "/api/matches");
  const skip = await call("POST", "/api/coach/skip");
  s = await state();
  check("   'Ask a human mentor now' skips the coach and asks a mentor at once", skip.json.ok === true && s.coach?.status === "skipped" && !!s.pending_request, { coach: s.coach, pending: s.pending_request });
  if (process.env.KEEP_END_STATE !== "1") await call("POST", "/api/demo/reset");
}

const fx = await (await fetch(`${BASE}/api/demo/fixtures`)).json();
if (process.env.KEEP_END_STATE === "1") {
  await declineRun(fx);
  for (let i = 1; i <= RUNS; i++) await runOnce(i, fx);
} else {
  for (let i = 1; i <= RUNS; i++) await runOnce(i, fx);
  await declineRun(fx);
  await coachRun(fx);
  await noActionsRun(fx);
  await callRejoinRun(fx);
}
console.log(failures === 0 ? `\nAll checks passed (${RUNS} runs).` : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
