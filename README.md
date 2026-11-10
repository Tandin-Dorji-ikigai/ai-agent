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
| 3. Reliability | Partly done: idempotent booking, confirmation and replies; no negative credit; one open escalation per action |
| 4. Freeze | Not started |

## Quick start

```bash
npm install
cp .env.example .env.local      # then fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
```

**Live AI (optional, free):** create a key at console.groq.com and add `GROQ_API_KEY=...` and `AI_MODE=live` to `.env.local`. Without them the app runs entirely on saved responses. Each person should use their own key, because the free limits are per key: 1,000 requests a day and 8,000 tokens a minute per model.

**Apply the database migrations** to your Supabase project. Choose one way:

- In the Supabase dashboard, open the SQL Editor and run the two files in `supabase/migrations/` in order.
- With the CLI: `npx supabase link --project-ref <ref>`, then `npx supabase db push`.

Then:

```bash
npm run dev                      # http://localhost:3000
```

Open the app and click **Load demo data**, or go to the YDF view and press **Reset demo**.

**Offline / local database (optional, needs Docker):** run `npm run db:local:start`. It applies the migrations automatically. Then point `.env.local` at `http://127.0.0.1:54321`.

### Checks

```bash
npm test             # 47 unit tests: ranking, fallbacks, reply reading, decision rules, agenda, AI timeout handling
npm run lint
npm run typecheck
npm run demo:e2e     # all 14 demo steps plus every check-in branch, twice. RESETS THE DEMO DATA
PACE_MS=3000 RUNS=1 npm run demo:e2e   # with AI_MODE=live: stays under the free tier, prints live vs saved counts
```

## Demo script (about 3 minutes)

1. **Entrepreneur view** (phone width). The assessment is pre-filled with Pema's answers. Press **Find my mentors**.
2. Three ranked mentors appear, each with a score breakdown and an explanation built from evidence. Point out that the most-booked mentor ranks 13th of 13.
3. **Choose Deki**, keep **Use my YDF credit**, then **Book session**. Pema's preparation checklist appears.
4. **Mentor view**. Show the brief, press **Complete session** (or, with live AI, **Record voice note**), review the three draft actions, then **Confirm 3 actions**.
5. **YDF view**. Press **Fast-forward 5 days**. The scheduling agent checks in on the interviews (due soon) and follows up on the permits action (overdue).
6. **Entrepreneur view**. Two messages need a reply. Reply to the interviews check-in first (pre-filled "going well"): the agent confirms the next check-in. Then reply to the permits follow-up (pre-filled with the blocker).
7. The agent decides **Escalate to YDF**. On the **Mentor view**, show the agenda for the next session and the progress feed. On the **YDF view**, show ESC-101, the metrics, and the activity log with its decision factors and tool calls.
8. Press **Reset demo** before the next rehearsal.

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
              |  10 controlled tools        |
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
- **Demo clock:** fast-forward moves an offset stored in `demo_state`, and the whole app reads time through it (`demo_now()` in SQL, `getDemoClock()` in TypeScript). The real clock is never changed.

### Repository layout

```text
supabase/migrations/
  20261110000001_schema.sql          tables, constraints, RLS
  20261110000002_demo_functions.sql  create_booking, confirm_action_items, fast_forward_demo, reset_demo
  20261110000003_checkin_loop.sql    SMART measure, check-in schedule, progress_updates, new event types
src/lib/
  agent/       runner, handlers (one per event), tools, schemas, fallbacks, policy, prompts
               ai.ts (fallback wrapper and guards), llm.ts (Groq client), live.ts (live prompts),
               json-schema.ts (zod schema to strict JSON schema)
  matching/    score-mentor.ts (deterministic ranking)
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
| POST | `/api/matches` | 2-4 |
| POST | `/api/booking` | 5-8 (idempotent on `idempotency_key`) |
| POST | `/api/session/complete` | 9-10 |
| POST | `/api/actions/confirm` | 11 (idempotent) |
| POST | `/api/actions/status` | Pema marks an action done |
| POST | `/api/demo/fast-forward` | 12 (overdue follow-ups and due check-ins) |
| POST | `/api/inbox/reply` | 13 (one decision per check-in or follow-up) |
| POST | `/api/agent/run` | Retry a failed event |
| POST | `/api/transcribe` | Voice note to text (Whisper); live AI only |
| POST | `/api/demo/reset` | Restore the starting state (one transaction) |
| GET | `/api/demo/fixtures` | Scripted demo inputs |

The demo endpoints have no authentication. **Do not deploy this publicly as it is**: anyone could reset the data.

## Responsibility boundaries

**AI agent:** writes the assessment summary, explains matches using only the score breakdown, writes session briefs, extracts draft actions, follows up on overdue actions, and chooses one next step for a blocker.

**Deterministic platform:** mentor scoring, availability, bookings, simulated payments, credit deduction, ownership checks, status transitions, and the agent log.

**Humans:**
- The entrepreneur chooses the mentor and confirms any suggested session.
- The mentor delivers the session and confirms the draft actions.
- YDF approves credit, assigns and resolves escalations, and selects seed-fund winners.
- Qualified people handle legal, financial and other sensitive advice.

The agent **cannot**:
- approve mentors, credit, funding or payments
- set fees
- resolve or assign escalations
- recommend unapproved resources or unverified, inactive or fully booked mentors
- answer sensitive topics (permits, registration, tax) itself

These rules are enforced in code (`tools.ts`, `policy.ts`), not only in prompts.

## Data model

The source of truth is `supabase/migrations/20261110000001_schema.sql`. The tables from the original plan are all there, with these changes:

- `profiles` no longer references `auth.users`, because the prototype has no login.
- `entrepreneur_profiles` adds `expertise_needs`, `languages` and `assessment_completed_at`.
- `mentor_profiles` adds `slots_remaining`, `sessions_delivered` and `headline`.
- `action_items` adds `owner`, `due_in_days` and a `draft` status. Drafts become `pending` only after human confirmation.
- `agent_runs` adds `source` (`live_ai` or `fallback`), `decision` and `decision_factors`.
- `escalations` adds a readable `code` (ESC-101, and so on), and allows only one open escalation per action.
- New tables:
  - `resources`: approved resources only
  - `messages`: the agent inbox
  - `demo_state`: the demo clock
  - `progress_updates`: the mentor progress feed (migration 003)
- Migration 003 also gives `action_items` a `success_measure`, `next_check_in_at` and `last_check_in_at`.

## Agent tools

Defined in `src/lib/agent/schemas.ts` (inputs) and `tools.ts` (implementations). Each event type may use only its listed tools (`ALLOWED_TOOLS` in `handlers.ts`).

`get_entrepreneur_context`, `find_matching_mentors`, `create_booking_request`, `create_session_brief`, `extract_action_items`, `update_action_status`, `recommend_approved_resource`, `suggest_mentor_session`, `create_escalation`, `send_inbox_message`, `record_progress`, `schedule_check_in`, `request_mentor_help` (only to the mentee's own mentor)

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

## Dzongkha moment

`src/lib/demo/dzongkha.ts` holds one follow-up message. **A fluent teammate must write and verify the Dzongkha text.** Until `verified: true`, the app shows English with the label "Dzongkha version pending review". Unreviewed machine translation is never shown.

## Definition of done (14 steps)

1. Pema submits a needs assessment.
2. The backend calculates mentor scores.
3. The system returns three verified mentors.
4. The AI explains each match using only supplied evidence.
5. Pema selects a mentor.
6. Pema selects simulated YDF sponsorship.
7. The platform creates a simulated booking.
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
- Video calling
- Production SMS or WhatsApp
- Native apps
- Full multilingual translation
- Advanced analytics
- Multiple agents
- Vector databases
- Microservices
- Production authentication or identity verification

## Demo story

> Pema is building a community-tourism business outside Thimphu. She did not attend a YDF training programme. She completes the AI assessment and receives three verified mentor recommendations with fees and explanations. She chooses a Dzongkha-speaking tourism mentor and uses a simulated YDF credit. The agent prepares both participants. After the session, it extracts three actions. The demo clock advances, one action becomes overdue, and the agent asks Pema about the blocker. Because she needs specialist help with permits, and no approved resource or verified mentor covers it, the agent creates a YDF escalation.

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
