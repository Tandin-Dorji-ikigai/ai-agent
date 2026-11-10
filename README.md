# AI Mentoring Platform - Hackathon Prototype

Show Me Your Agent Hackathon 2026 (Innovate Bhutan / YDF). Problem focus: continuity, with matching as the entry point.

> The AI coordinates, prepares, matches, and follows up. Verified humans mentor, approve sponsorship, resolve disputes, and make funding decisions.

`CLAUDE_WORKING_PLAN.md` holds the build rules and milestones. **Where the two files disagree, the working plan wins.** This README was updated on 2026-11-10 to match it. The original plan is kept at `~/Documents/ChatGPT/Agent/README.md`.

## Status

| Milestone | Status |
|---|---|
| 0. Repository audit | Done (empty repository) |
| 1. End-to-end skeleton, all 14 steps on saved responses | **Done.** `npm run demo:e2e` passes twice in a row on a local database, and the full flow was clicked through in a headless browser |
| 1b. Team workflow: check-in loop (on track / obstacle / needs help / done), SMART actions, mentor progress, next session | **Done.** Migration 003; every branch is covered by `npm run demo:e2e` |
| 2. Live AI | **Done.** Groq free tier: `gpt-oss-120b` and `gpt-oss-20b` (strict JSON output and real tool calling), plus Whisper for voice notes. Every step falls back to its saved response |
| 2b. Long call transcripts and an extraction test set | **Done.** Calls of any length are read in parts, paced to the free tier, in the background. `npm run eval:extraction` scores the agent on 5 sample cases |
| 2c. Voice intro for the needs assessment (English), including aspiring entrepreneurs with no business yet | **Done.** The agent drafts the answers (heard or suggested), asks only what it still needs as tap-to-answer questions, and the entrepreneur checks before submitting. `npm run eval:assessment` scores it |
| 2d. Mentor requests: the agent asks, the mentor decides | **Done.** Migration 005. After matching, the agent sends a request to the best bookable mentor. The mentor accepts (and picks one of their usual times) or declines. On a no, or no reply in 2 days, the agent asks the next best; after three it hands over to YDF. Covered by `npm run demo:e2e` |
| 3. Reliability | Partly done: idempotent request acceptance, confirmation and replies; credit used only when a mentor accepts; no negative credit; never two open requests; one open escalation per action |
| 4. Freeze | Not started |

## Quick start

**Screens (MentorFlow UI, from PR #2, connected to the backend):** entrepreneur screens start at `/entrepreneur/connect`, mentor screens at `/mentor/dashboard`, and YDF stays at `/ydf`. Every screen uses the real API (there is no sample-data mode). See `docs/ui-integration.md`.

**Video calls (optional, free):** create a project at cloud.livekit.io (no card needed) and add `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` to `.env.local`. Without them, calls work with no video (recording and transcripts still work). For local testing: `docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server:v1.9.1 --dev --bind 0.0.0.0 --node-ip 127.0.0.1`, then `LIVEKIT_URL=ws://localhost:7880`, `LIVEKIT_API_KEY=devkey`, `LIVEKIT_API_SECRET=secret`.

```bash
npm install
cp .env.example .env.local      # then fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
```

**Live AI (optional, free):** create a key at console.groq.com and add `GROQ_API_KEY=...` and `AI_MODE=live` to `.env.local`. Without them the app runs entirely on saved responses. Each person should use a key from their **own Groq account**, because Groq counts the free limits per account (not per key): 1,000 requests a day and 8,000 tokens a minute per model.

**Separate key for speech-to-text (optional):** add `GROQ_TRANSCRIBE_API_KEY=...` (a key from a different Groq account) and all transcription uses it: voice notes, voice intros, and call and video recordings. The agent keeps `GROQ_API_KEY`. Without it, transcription uses `GROQ_API_KEY`. The server log shows which one each transcription used.

**Apply the database migrations** to your Supabase project. Choose one way:

- In the Supabase dashboard, open the SQL Editor and run every file in `supabase/migrations/`, in order.
- With the CLI: `npx supabase link --project-ref <ref>`, then `npx supabase db push`.

Then:

```bash
npm run dev                      # http://localhost:3000
```

Open the app and click **Load demo data**, or go to the YDF view and press **Reset demo**.

**Offline / local database (optional, needs Docker):** run `npm run db:local:start`. It applies the migrations automatically. Then point `.env.local` at `http://127.0.0.1:54321`.

### Checks

```bash
npm test             # 131 unit tests: ranking, who is asked next, session times, fallbacks, reply reading, decision rules, agenda, AI guards
npm run lint
npm run typecheck
npm run demo:e2e     # all 14 demo steps and every check-in branch, twice, then a mentor declining, not replying, and the YDF hand-over. RESETS THE DEMO DATA
PACE_MS=3000 RUNS=1 npm run demo:e2e   # with AI_MODE=live: stays under the free tier, prints live vs saved counts
E2E_SOURCE=call_recording npm run demo:e2e   # the same demo from a call transcript, plus a 30-minute call read in the background
E2E_SOURCE=call npm run demo:e2e             # the same demo as a call: join, consent, one recording per person, merged transcript
npm run eval:extraction   # scores extraction on evals/extraction-cases.json (rule-based with AI_MODE=fixture, live AI with AI_MODE=live)
npm run eval:assessment   # scores drafting the assessment from speech on evals/assessment-cases.json (3 cases)
```

## Demo script (about 4 minutes)

1. Open three windows: **YDF** at `/ydf` (press **Reset demo**), **Pema** at `/entrepreneur/connect` (phone width), and **Deki** at `/mentor/dashboard`.
2. **Pema → Needs assessment.** It is pre-filled with her answers. Press **Save needs & find mentor**. On **Connect**, the agent has already asked Deki (the best match): who was asked, the reply deadline, how it is paid, and who is next. Nothing is booked or paid yet.
3. **Deki → Mentor requests.** Only need-to-know details (no budget), and why the agent picked Deki (88/100). Pick one of Deki's times and press **Accept**. (To show a no: press **Decline** with a reason; the agent asks Sonam next, and Pema's **My bookings** shows who said no and why.)
4. **Pema → My bookings.** The session time and the preparation brief appear; YDF shows Nu. 1,500 of credit used.
5. **The session.** On two devices, both press **Join session**, both agree to recording, talk, then both press **Leave**: each phone records only its own microphone, so the agent knows exactly who said what. (Or, on **Deki → Session workspace**, write quick notes and press **Complete session & save notes**.)
6. **Deki → Session workspace.** Review the agent's draft actions and press **Confirm selected actions**.
7. **YDF → Fast-forward 5 days.** The agent checks in on the interviews (due soon) and follows up on the permits action (overdue).
8. **Pema → Notifications.** Reply to the interviews check-in ("Going well, I have spoken to 3 guests"): the agent confirms the next check-in. Reply to the permits follow-up ("I'm stuck: I don't know which permit the guided walk needs"): the agent escalates to YDF, **ESC-101**.
9. **YDF:** the escalation, the metrics, and **Agent activity** with each decision's factors and the tools used.
10. **Reset demo** (YDF) before the next rehearsal.

## Architecture

```text
 Entrepreneur view        Mentor view           YDF view
 (mobile-first,           (brief, quick         (credits, outcomes,
  agent inbox)             session notes)        escalation queue, agent log)
        \                      |                      /
         +---- Next.js app (one runtime) ------------+
                               |
              Route handlers (src/app/api/*)
                               |
              +------ MENTORING AGENT ------+
              |  runner: events run inline  |
              |  13 controlled tools        |
              |  saved fallback per AI step |
              +------------------------------+
                               |
                 Supabase Postgres (service role, server only)
```

- **One runtime:** UI, route handlers, agent, scoring, fast-forward and reset all run in Next.js. There are no Supabase Edge Functions.
- **No login:** a demo role switcher (Entrepreneur / Mentor / YDF) replaces Supabase Auth.
- **Database access:** server only, with the service-role key. Row-level security is on for every table with no policies, so the public anon key can read nothing (verified).
- **Agent events:** an event runs immediately after it is created, so the demo never waits for a worker. `agent_events` still records every event; a failed event can be retried from the YDF log (`POST /api/agent/run`).
- **Check-in loop (team workflow):** confirmed actions are SMART (with a "done when" measure) and get a check-in two days before they are due. Each reply is read as done, on track, or stuck (with or without needing help). Then the agent marks it done, confirms the next check-in, records the obstacle, recommends an approved resource, asks the mentee's own mentor (onto the next session's agenda), suggests another mentor, or escalates to YDF for sensitive topics. Every outcome goes into the mentor's progress feed, and a follow-up booking is briefed from it.
- **Mentor requests (the mentor decides):** after matching, the agent sends a request to the best-ranked mentor who is verified, active and has open sessions (never one below 40/100). The mentor sees only what they need: the mentee's needs, stage, sector, challenge, language and why they were picked (no phone number or budget). They accept by picking one of their usual weekly times (Bhutan time), or decline with a reason. Only then is anything booked or any YDF credit used (`accept_mentor_request` in SQL, one transaction). On a decline, or no reply within 2 days, the agent asks the next best mentor and tells the mentee why; after three mentors it creates a YDF escalation. A mentee can also ask for a specific mentor (a follow-up, or one the agent suggested), and the same rules apply.
- **Calls:** one LiveKit room per confirmed booking (two people at most, a personal pass each), only for its two participants; it closes when the session completes. With both people's consent, each browser records only its own microphone and uploads it in 5-minute parts; each part is transcribed (speech-to-text key) and the audio is discarded. When the call ends, the parts are merged by time into `[Mentor]` / `[Entrepreneur]` turns (Whisper's silence inventions and speaker echoes dropped), and the session completes like typed notes do. With labelled lines, a speaker's own "I will..." is their action and "you..." the other person's. Without the LiveKit settings there is no video, but everything else works. The call screen is `src/components/call/call-room.tsx`.
- **Demo clock:** fast-forward moves an offset stored in `demo_state`, and the whole app reads time through it (`demo_now()` in SQL, `getDemoClock()` in TypeScript). The real clock is never changed.

### Repository layout

```text
supabase/migrations/
  20261110000001_schema.sql          tables, constraints, RLS
  20261110000002_demo_functions.sql  create_booking, confirm_action_items, fast_forward_demo, reset_demo
  20261110000003_checkin_loop.sql    SMART measure, check-in schedule, progress_updates, new event types
  20261110000004_session_sources.sql where session text came from (typed / voice note / call) + transcript
  20261110000005_mentor_requests.sql mentor_requests, weekly times, accept_mentor_request, new events
  20261110000006_calls.sql           calls (one room per booking) and call_track_parts (text only, per person)
  20261111000007_livekit_calls.sql   calls may use LiveKit
src/lib/
  audio/       transcribe.ts (Whisper)
  agent/       runner, handlers (one per event), tools, schemas, fallbacks, policy, prompts
               ai.ts (fallback wrapper and guards), llm.ts (Groq client), live.ts (live prompts),
               json-schema.ts (zod schema to strict JSON schema)
  matching/    score-mentor.ts (deterministic ranking), requests.ts (who is asked next, funding,
               what the mentor sees), slots.ts (weekly times to concrete times, Bhutan time)
  requests.ts  accept, decline and expiry of mentor requests (what people do)
  progress.ts  mentor progress feed and next-session agenda
  demo/        ids, seed-data (single source of truth), fixtures, dzongkha
  supabase/    server-only client
  state.ts     GET /api/state builder (all dashboard numbers come from here)
src/app/
  api/         route handlers (see below)
  entrepreneur/ mentor/ ydf/   the three views
src/components/  UI
scripts/demo-e2e.mjs  end-to-end check
```

### API

| Method | Path | Demo step |
|---|---|---|
| GET | `/api/state` | Everything every view needs |
| POST | `/api/assessment` | 1 |
| POST | `/api/assessment/draft` | Voice intro: `{ transcript }` → `{ draft, missing, source }`. Saves nothing; the entrepreneur checks the form and submits it |
| POST | `/api/matches` | 2-4 |
| POST | `/api/requests/accept` | 6-8. The mentor accepts: `{ request_id, scheduled_at }` (one of the request's `offered_slots`). Books the session, uses credit now; idempotent |
| POST | `/api/requests/decline` | The mentor declines: `{ request_id, reason: no_time \| not_my_area \| other, note? }`. The agent asks the next best mentor, or YDF after three |
| POST | `/api/requests/ask` | The mentee asks for a specific mentor (follow-up or suggestion): `{ mentor_id }` |
| POST | `/api/requests/start` | Keeps the agent going with no button: if there are matches but nobody is being asked (older data, or a failed step), the agent asks now. The entrepreneur view calls it by itself. Safe to repeat; returns `{ started, reason }` |
| POST | `/api/session/complete` | 9-10. Handover contract: `{ booking_id, notes?, transcript?, source: typed \| voice_note \| call_recording }`. Long transcripts return `202 { processing: true }` and are read in the background; over 200,000 characters returns `400` |
| POST | `/api/actions/confirm` | 11 (idempotent) |
| POST | `/api/actions/status` | Pema marks an action done |
| POST | `/api/demo/fast-forward` | 12 (overdue follow-ups and due check-ins; mentor requests past their deadline expire) |
| POST | `/api/inbox/reply` | 13 (one decision per check-in or follow-up) |
| POST | `/api/agent/run` | Retry a failed event |
| POST | `/api/calls/join` | Join the call for a confirmed booking: `{ booking_id, role }` → `livekit: { url, token }` (a personal pass), `call_id`, `server_time_ms` |
| POST | `/api/mentors/availability` | The mentor's usual weekly times: `{ mentor_id, weekly_slots: [{ day, time }] }`. New requests offer the next of these |
| POST | `/api/calls/consent` | `{ call_id, role, consent }`. Recording only when both agree |
| POST | `/api/calls/track` | Multipart: one part of ONE person's microphone (`call_id, role, part, started_at_ms, file`). Transcribed, audio discarded |
| POST | `/api/calls/end` | `{ call_id, role, force? }`. When both end: merged transcript with certain speakers → session completed → agent drafts actions |
| POST | `/api/transcribe` | Audio to text (Whisper); live AI only. `mode=voice_note` (default, optional `language=en`) or `mode=call_recording` (speaker-labelled when the guess finishes safely: `labeled: true`) |
| POST | `/api/demo/reset` | Restore the starting state (one transaction) |
| GET | `/api/demo/fixtures` | Scripted demo inputs |

The demo endpoints have no authentication. **Do not deploy this publicly as it is**: anyone could reset the data.

## Responsibility boundaries

**AI agent:** writes the assessment summary, explains matches using only the score breakdown, writes session briefs, extracts draft actions, follows up on overdue actions, and chooses one next step for a blocker.

**Deterministic platform:** mentor scoring, availability, bookings, simulated payments, credit deduction, ownership checks, status transitions, and the agent log.

**Humans:**
- Each mentor decides every request: accept with a time that suits them, or decline.
- The entrepreneur can change their answers, and can ask for a specific mentor (a follow-up, or one the agent suggested).
- The mentor delivers the session and confirms the draft actions.
- YDF approves credit, assigns and resolves escalations, and selects seed-fund winners.
- Qualified people handle legal, financial and other sensitive advice.

The agent **cannot**:
- approve mentors, credit, funding or payments
- accept a request for a mentor, or book a session a mentor has not accepted
- set fees
- resolve or assign escalations
- recommend unapproved resources or unverified, inactive or fully booked mentors
- answer sensitive topics (permits, registration, tax) itself

These rules are enforced in code (`tools.ts`, `policy.ts`), not only in prompts.

## Data model

The source of truth is `supabase/migrations/20261110000001_schema.sql`. The tables from the original plan are all there, with these changes:

- `profiles` no longer references `auth.users`, because the prototype has no login.
- `entrepreneur_profiles` adds `expertise_needs`, `languages` and `assessment_completed_at`.
- `mentor_profiles` adds `slots_remaining`, `sessions_delivered`, `headline` and `weekly_slots` (usual times, migration 005).
- `action_items` adds `owner`, `due_in_days` and a `draft` status. Drafts become `pending` only after human confirmation.
- `agent_runs` adds `source` (`live_ai` or `fallback`), `decision` and `decision_factors`.
- `escalations` adds a readable `code` (ESC-101, and so on), and allows only one open escalation per action.
- New tables:
  - `resources`: approved resources only
  - `messages`: the agent inbox
  - `demo_state`: the demo clock
  - `progress_updates`: the mentor progress feed (migration 003)
  - `mentor_requests`: each request the agent sends, the times offered, and the mentor's answer (migration 005)
- Migration 003 also gives `action_items` a `success_measure`, `next_check_in_at` and `last_check_in_at`.

## Agent tools

Defined in `src/lib/agent/schemas.ts` (inputs) and `tools.ts` (implementations). Each event type may use only its listed tools (`ALLOWED_TOOLS` in `handlers.ts`).

`get_entrepreneur_context`, `find_matching_mentors`, `send_mentor_request` (asks; only the mentor can accept), `create_session_brief`, `extract_action_items`, `update_action_status`, `recommend_approved_resource`, `suggest_mentor_session`, `create_escalation`, `send_inbox_message`, `record_progress`, `schedule_check_in`, `request_mentor_help` (only to the mentee's own mentor)

## Mentor scoring (deterministic)

| Factor | Points |
|---|---|
| Expertise overlap (share of needs covered) | 35 |
| Sector match | 20 |
| Business-stage match | 15 |
| Language: preferred = 10, another shared language = 5 | 10 |
| Availability: 2+ slots = 10, 1 slot = 5, fully booked = 0 | 10 |
| Budget: within = 10, up to 50% over = 5 | 10 |

Only verified, active mentors are ranked. Ties are broken by more open slots, then lower fee, then id. Pema's top three are Deki Wangmo (88), Sonam Choden (77) and Ugyen Lhendup (70). The most-booked mentor, Karma Tshering, scores 5 out of 100.

## AI fallback policy

Every AI step goes through `aiStep()` (`src/lib/agent/ai.ts`). It tries live AI with a timeout, validates the output against the same schema, and otherwise uses the saved response. Every run records whether its result came from `live_ai` or `fallback`. `AI_MODE=fixture` (the default) makes no AI calls at all.

**Live AI (Groq, OpenAI-compatible; see `llm.ts` and `live.ts`):**
- `gpt-oss-120b` handles match explanations, briefs, action extraction and the help decision. `gpt-oss-20b` handles the summary, check-ins and reading replies. Each model has its own rate limit.
- **Strict JSON schema** output for every text step, converted from the same zod schemas and validated again by zod.
- The help decision uses **real tool calling**. The model must call exactly one of: `recommend_approved_resource`, `request_own_mentor_help`, `suggest_other_mentor`, `escalate_to_ydf`. IDs are restricted to real resources and mentors, and `validateDecision()` still has the final say.
- Match explanations are written only from facts our code computes (`explainMatch()`), so the model cannot misread the scores.
- **Guards:**
  - an 8 second timeout per step
  - a pause after a rate-limit refusal (HTTP 429)
  - a daily cap per server (`AI_DAILY_CALL_LIMIT`)
  - live text that guesses anyone's gender (he/she) is rejected and the saved response is used
- The server terminal shows token usage per call, plus why any saved response was used (`[ai] ...` lines). Prompts and keys are never logged.
- To switch to OpenAI or another compatible provider, change `AI_BASE_URL`, the key and the model names. Nothing else changes.
- **Pacing:** before each call, `llm.ts` waits if needed so each model stays under its tokens-per-minute limit (`AI_TPM_LIMIT`, default 8,000). This avoids rate-limit errors instead of reacting to them.
  - Quick steps wait at most 7 seconds, then use the saved response; other models are not paused.
  - Background work (long transcripts) waits as long as needed.

**Long call transcripts (`src/lib/agent/extract.ts`, `transcripts.ts`):**
- Text up to about 22,000 characters is read in one pass.
- Longer transcripts:
  1. are split into parts of about 6,000 characters at sentence boundaries;
  2. each part's agreements are pulled out by alternating the two models;
  3. the final step sees only the agreed actions, and its output is **grounded**: any action that matches no agreement is dropped.
- Owners come from the speaker's words ("I'll" = mentor, "you" = entrepreneur), not the AI's guess.
- It runs in the background with `after()`. The mentor view says "the agent is reading the session" until drafts appear. A 30-minute call takes about a minute on the free tier.
- Every step has a rule-based fallback that only keeps sentences where people agreed something, so it never invents tasks.

**Voice intro for the assessment** (`src/lib/agent/assessment-draft.ts`, `assessment-rules.ts`; English for now):
- **Aspiring entrepreneurs and students:**
  - the business name is optional;
  - sector can be "Not decided yet";
  - a new kind of help, "Finding and testing a business idea", is offered by Ugyen Lhendup and Dawa Penjor in the demo data;
  - a budget of 0 means "not sure yet" and is neutral in matching.
- **Heard vs suggested:** the agent may infer the stage, description, challenge, needs and sector from the meaning ("I don't have a business idea yet" means the idea stage). These are labelled "Suggested", and a name or budget is never guessed.
- **It asks instead of a form:** after the intro the screen shows "Here is what I understood", then only the follow-up questions still needed (tap chips or answer by voice). The full form sits behind "Review or change all answers".
- **It goes ahead by itself:**
  - Small gaps get safe defaults labelled **Assumed**: budget "not sure" (neutral in matching) and preferred language = the language spoken.
  - Once it has enough, a 5-second countdown ("Find them now" / "Wait, let me check first") saves the answers and finds mentors with no button press.
  - "Change my answers" on the recommendations re-opens the form and re-matches, and the agent asks again. A booking still needs the mentor's yes.
- **Flow:** speech goes to Whisper (with `language=en` and a spelling hint for local words), then the agent drafts the form. Fields that were not said are marked "Not mentioned", and the entrepreneur edits and submits as usual.
- **Grounding:** a business name, budget or language that was not actually said is removed from the AI's draft.
- **Misspellings:** speech-to-text spellings such as "Zonka" (Dzongkha) and "Gultrim" (ngultrum) are understood.
- **Fallback:** the rule-based reader.
- **Score** (`npm run eval:assessment`, 4 cases including an aspiring entrepreneur): live AI 100% of fields right with 0 invented. The rules also score 100%, but were tuned on the same cases.
- **Fixed after live testing:**
  - "I'm using this platform" no longer makes someone a technology business;
  - a sector without evidence in the speech is only a suggestion;
  - one named language becomes the preferred one;
  - greetings and names are kept out of descriptions.
- **Real audio test:** a spoken intro, transcribed and drafted, got every field right. Names can be misheard (for example "Yangchun" for "Yangchen"), which is why the entrepreneur checks the form.

**Extraction quality** (`npm run eval:extraction`, 5 cases: short call, voice note with a corrected deadline, 30-minute call, mentor-owned actions, a chat with nothing agreed):
- **Live AI, final version:** 100% of expected actions found, no extra actions, due dates and owners 100%, no forbidden actions.
- Earlier runs caught two weaknesses, now fixed in code rather than prompts:
  - owners guessed wrongly (75%); now decided by the speaker's words
  - "possibilities" turned into tasks; the final step is now grounded on the real agreements
- **Rule-based fallback:** also 100%, but it was tuned on these same cases, so treat that number as optimistic.
- Add real transcripts to the set to get honest numbers.

## Dzongkha moment

`src/lib/demo/dzongkha.ts` holds one follow-up message. **A fluent teammate must write and verify the Dzongkha text.** Until `verified: true`, the app shows English with the label "Dzongkha version pending review". Unreviewed machine translation is never shown.

## Definition of done (14 steps)

1. Pema submits a needs assessment.
2. The backend calculates mentor scores.
3. The system returns three verified mentors.
4. The AI explains each match using only supplied evidence.
5. The agent asks the best-matched mentor.
6. The mentor accepts and picks a time.
7. The platform books it, paid with simulated YDF credit.
8. The agent produces entrepreneur and mentor briefs.
9. The mentor submits quick session notes.
10. The agent extracts draft action items.
11. A human confirms the action items.
12. Fast-forward makes one action overdue.
13. The agent asks about the blocker and chooses a controlled next action.
14. The YDF dashboard updates with credits, session outcome, actions and escalation.

The header shows progress (x/14), and the YDF view has the checklist.

## Out of scope for the hackathon

- Real payments or seed-fund disbursement
- Building our own video calling (a link to a hosted meeting is fine)
- Production SMS or WhatsApp
- Native apps
- Full multilingual translation
- Advanced analytics
- Multiple agents
- Vector databases
- Microservices
- Production authentication or identity verification

## Demo story

> Pema is building a community-tourism business outside Thimphu. She did not attend a YDF training programme. She completes the AI assessment and receives three verified mentor recommendations with fees and explanations. The agent asks the best match, a Dzongkha-speaking tourism mentor, who accepts and picks a time; the session uses a simulated YDF credit. The agent prepares both participants. After the session, it extracts three actions. The demo clock advances, one action becomes overdue, and the agent asks Pema about the blocker. Because she needs specialist help with permits, and no approved resource or verified mentor covers it, the agent creates a YDF escalation.

All people, businesses, resources and organisations in the seed data are fictional.

## Handoff prompt for another coding assistant

```text
Read README.md and CLAUDE_WORKING_PLAN.md completely before making changes
(the working plan wins where they differ). We are building a 2.5-day hackathon
prototype of an AI mentoring platform using Next.js 16, TypeScript, Supabase
Postgres, and an AI API with structured tool calling.

Milestones 1 and 2 are complete: all 14 steps work on saved responses and
on live AI (Groq), and `npm run demo:e2e` must keep passing in both modes. Keep all agent logic in the Next.js
server runtime. Never expose the service-role key to browser code. Do not add
production features listed as out of scope.

Before implementing, run npm test, npm run lint and npm run typecheck, and report:
1. What is already complete
2. What differs from the README
3. The smallest next implementation step
4. Any blocking decisions or missing credentials

Preserve existing work and make incremental, testable changes.
```
