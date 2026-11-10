# Team Onboarding: Mentoring Agent

Welcome to the team. This guide gets you from zero to a running app in about 15 minutes, then explains how we work together for the rest of the hackathon.

**Read this first, then `README.md`.** `CLAUDE_WORKING_PLAN.md` contains the build rules; if it ever disagrees with the README, the working plan wins.

---

## 1. What we are building (2 minutes)

**Hackathon:** Show Me Your Agent Hackathon 2026, by Innovate Bhutan and the YDF Institute for Innovation and Entrepreneurship.
**Challenge:** use agentic AI to make mentoring for Bhutanese entrepreneurs accessible, personalised and continuous. The organisers said explicitly: *not a mentor directory and not a general chatbot*.

**Our answer:** an agent that **matches, prepares, follows up and escalates**.

> The AI coordinates, prepares, matches, and follows up. Verified humans mentor, approve sponsorship, resolve disputes, and make funding decisions.

**The demo story we will present:** Pema runs a small community-tourism business outside Thimphu.

1. She fills in a needs assessment.
2. She gets three ranked mentors, each with reasons.
3. She books Deki, a Dzongkha-speaking tourism mentor, using a YDF credit.
4. The agent briefs both of them before the session.
5. After the session, it turns the mentor's notes into three actions.
6. A few days later the agent checks in: one action is going well (it confirms the next check-in), one is overdue.
7. Pema is stuck on permits, which no approved resource or verified mentor covers, so the agent escalates to YDF. Her mentor sees all of this in a progress feed and an agenda for their next session.

**The judges will be asked to look for:**

| What the brief asks for | Where our app shows it |
|---|---|
| The right mentor, not the most visible one | Fixed-rule ranking with a visible breakdown. The most-booked mentor ranks 13th of 13 for Pema |
| What the agent does alone vs what stays human | Drafts need human confirmation; the agent can never approve credit or resolve escalations |
| Inclusion: Dzongkha and English, low connectivity | Language counts in matching; phone-first screens; one Dzongkha message (still needs our review) |
| Mentor experience: less coordination, more guidance | The mentor view: a brief arrives, short notes go in, the agent does the rest |
| Trust: advice quality, privacy, handoff to humans | Escalation queue, decision factors in the activity log, approved resources only |

## 2. Where we are

| Milestone | Status |
|---|---|
| 1. All 14 demo steps working on saved responses | **Done.** Tested end to end twice against our Supabase project |
| 1b. Our workflow diagram: check-ins, on track / obstacle / needs help / done, SMART actions, mentor progress, next session | **Done** |
| 2. Live AI | **Done.** We use **Groq** (free): two open models plus Whisper for voice notes. Saved responses remain the backup |
| 3. Reliability polish | Partly done |
| 4. Freeze: no new features, rehearse, record backup video | End of Day 2 |

Every AI step has a **saved response** as a backup. The demo still works with no key, with no internet, or when Groq's free limit is hit. In the app, each AI output is labelled **Live AI** or **Saved response**.

### What is built (and tested)

| Area | What works today | Where |
|---|---|---|
| Needs assessment | Pre-filled form, AI summary | `entrepreneur/assessment-form.tsx`, `/api/assessment` |
| Matching | Fixed-rule ranking of 15 mentors; top 3 with AI explanations written from verified facts | `matching/score-mentor.ts`, `/api/matches` |
| Mentor requests (the mentor decides) | After matching, the agent asks the best mentor by itself (no button; if a step was missed or failed, it picks it up again when Pema's screen opens). The mentor accepts (picking one of their usual times) or declines with a reason. On a no, or no reply in 2 days, the agent asks the next best and tells the mentee why; after three, YDF is asked to help. Nothing is booked and no credit is used until a mentor accepts | `matching/requests.ts`, `matching/slots.ts`, `lib/requests.ts`, `/api/requests/*`, SQL `accept_mentor_request` |
| Booking | Created only when a mentor accepts: YDF credit or simulated self-payment; cannot double-book or double-charge | SQL `accept_mentor_request` → `create_booking` |
| Session prep | AI briefs for both sides; follow-up briefs built from progress | `agent/handlers.ts` |
| After the session | Mentor's quick notes become SMART draft actions; the mentor confirms them | `mentor-view.tsx`, `/api/session/complete`, `/api/actions/confirm` |
| Check-in loop (our workflow diagram) | Check-ins before due dates and follow-ups once overdue. Replies are read as done, on track, or stuck, and every branch is handled | `agent/handlers.ts`, `agent/policy.ts` |
| Getting help | The AI picks one tool (approved resource, own mentor, another mentor, or YDF escalation), and our rules double-check its choice | `agent/live.ts`, `agent/policy.ts` |
| Mentor progress | Progress feed and next-session agenda | `progress.ts`, `mentor-view.tsx` |
| YDF dashboard | Metrics from the database, escalation queue, agent activity log, demo controls | `ydf-view.tsx` |
| Live AI | Groq `gpt-oss-120b` and `gpt-oss-20b`, with timeouts, pacing under the free limits, a daily cap, and a check that blocks gender guessing | `agent/ai.ts`, `agent/llm.ts`, `agent/live.ts` |
| Long call transcripts | Calls of any length are read in parts in the background (a 30-minute call takes about a minute); only real agreements become actions | `agent/extract.ts`, `agent/transcripts.ts` |
| Extraction test set | `npm run eval:extraction` scores the agent on 5 sample cases. Live AI: 100% found, no extras, due dates and owners right | `evals/extraction-cases.json`, `scripts/eval-extraction.mjs` |
| Voice notes (**basic version**) | Record or upload audio in the mentor view; Whisper turns it into text for the mentor to check. See section 9 | `mentor-view.tsx` (`VoiceNote`), `/api/transcribe` |
| Voice intro for the assessment (English) | Pema, or someone with no business yet, can speak instead of typing. The agent shows "Here is what I understood" (heard or suggested) and asks only the missing answers as tap-to-answer questions. "Use a sample intro" and "Try a sample without a business" work without a microphone | `entrepreneur/assessment-form.tsx`, `voice/voice-recorder.tsx`, `agent/assessment-draft.ts`, `agent/assessment-rules.ts`, `/api/assessment/draft` |
| Tests | 131 unit tests. `npm run demo:e2e` runs the whole demo in both modes, plus a mentor declining, not replying, and the hand-over to YDF | `src/**/*.test.ts`, `scripts/demo-e2e.mjs` |

### What is not built yet

| Gap | Notes | Suggested owner |
|---|---|---|
| Dzongkha message | The slot exists but is empty, so the app shows English with "pending review" | Any fluent speaker on the team |
| Voice notes: real-device testing and polish | Tested only by uploading one computer-generated recording. The **Record** button has not been tried with a real microphone, on phones, on Safari, with background noise, or in Dzongkha | Audio-to-text teammate |
| Calls | No call yet. Plan: a "Join call" link to a hosted meeting, with an audio-only option | Calls teammate |
| Real transcripts in the test set | The 5 test cases are written by us. Real (anonymised, consented) transcripts would give honest accuracy numbers | Agent (Tandin), with audio-to-text |
| YDF acting on escalations | The queue is read-only. **Deferred** by team decision | Nobody for now |
| UI polish and a real-phone check | Works and passes accessibility checks, but not yet designed for the pitch | Frontend teammate |
| Reliability target | The plan asks for 5 reset-to-finish runs in a row; 2 done so far | Agent (Tandin) |
| Pitch | Interviews for real quotes, slides, demo script, backup video, rehearsals | Shared: agree who at check-in |
| Out of scope on purpose | Real login, real payments, SMS or WhatsApp, a public URL | Nobody. Present them as next steps in the pitch |

---

## 3. Get access (ask Tandin)

You need two invitations. Accept both from your email.

1. **GitHub:** collaborator on `Tandin-Dorji-ikigai/ai-agent` with Write access.
2. **Supabase:** member of the organisation that owns the **AI-Agent** project, with the **Developer** role.

Use your **personal** GitHub and Supabase accounts, not work accounts.

## 4. Set up your laptop (about 10 minutes)

**You need:** Node.js 20.9 or newer (`node -v` to check; we use 24), Git, and a code editor. Docker is optional (only for an offline database).

```bash
git clone https://github.com/Tandin-Dorji-ikigai/ai-agent.git
cd ai-agent
npm install
cp .env.example .env.local
```

**Fill in `.env.local`** with two values from the Supabase dashboard (AI-Agent project):

| Variable | Where to find it |
|---|---|
| `SUPABASE_URL` | Project Settings, Data API: **Project URL** (looks like `https://xxxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings, API Keys, **Legacy API keys** tab: the **service_role** key (click Reveal) |

**Live AI (free, recommended):**
1. Create your **own** key at console.groq.com. The free limits are per key, so don't share one.
2. Add two lines to `.env.local`:
   ```
   AI_MODE=live
   GROQ_API_KEY=gsk_...
   ```
   No quotes, and no spaces around `=`.

With `AI_MODE=fixture`, or no key, everything still works on saved responses. The header shows which mode is on: **AI: live** or **AI: saved responses**.

> **Why the legacy key?** The new-style secret key also works if you copy it from the dashboard, but the Supabase CLI only shows a masked version of it, which fails. The legacy service_role key works everywhere.
>
> **Can't see the key?** Your role may not allow it. Ask Tandin to send it to you **privately**, never in a group chat and never in git.

**Do NOT run `supabase db push`.** The tables already exist in our project.

**Start the app:**

```bash
npm run dev
```

Open http://localhost:3000. If you see the three view cards and a "Demo controls" box, you are connected.

**Check everything works:**

```bash
npm test          # 131 unit tests, about 1 second
npm run lint
npm run typecheck
```

Then walk through the demo yourself (section 6).

## 5. The secret key: rules

`SUPABASE_SERVICE_ROLE_KEY` can read and write **everything** in our database.

- It lives only in `.env.local`, which git ignores. Never commit it, paste it into chat, or put it in a screenshot. The same applies to `GROQ_API_KEY`.
- Never rename it to `NEXT_PUBLIC_...`. That would send it to every browser.
- Only code under `src/lib` and `src/app/api` (server code) may use it. Browser code never touches the database directly.
- The repository is **public**. Anything committed can be read by anyone.

---

## 6. The demo, click by click (3 minutes)

Use the **Entrepreneur / Mentor / YDF** tabs at the top. The header shows the demo clock and how many of the 14 steps are done.

1. **Entrepreneur:** the form is pre-filled with Pema's answers. Optionally show **Use a sample intro**, or **Try a sample without a business** (the agent asks 2 quick questions, then matches idea mentors). **Find my mentors.**
2. Three ranked mentors appear. Open **See the score breakdown**. Read the note about the most-booked mentor. **Your mentor request** shows the agent has already asked Deki (best match), the reply deadline, and that Sonam is next. Credit is still Nu. 3,000.
3. **Mentor** (signed in as Deki): the request shows Pema's needs, why Deki was picked, and the fee. Pick a time, **Accept**. Back on **Entrepreneur**: the session time and prep checklist appear; credit drops to Nu. 1,500. (To show a no: press **Decline** instead. The mentor view switches to Sonam, whom the agent asked next.)
4. **Mentor:** read the brief, **Complete session**, review the three drafts, **Confirm 3 actions**. With live AI you can also **Record voice note**; the text is filled in for you to check.
5. **YDF:** **Fast-forward 5 days**. The agent checks in on the interviews (due soon) and follows up on the permits action (overdue).
6. **Entrepreneur:** two messages need a reply. **Send reply** on the interviews check-in first ("going well"): the agent confirms the next check-in. Then **Send reply** on the permits follow-up: the agent escalates, **ESC-101**.
7. **Mentor:** the agenda for the next session and the progress feed. **YDF:** metrics, the escalation, and the **Agent activity** log with decision factors and the tools used.
8. **Reset demo** (YDF view) to start again.

Tip: narrow your browser window, or use the browser's mobile view, to see Pema's screen as it looks on a phone.

## 7. Shared database: team rules

All three of us use **one** Supabase database, and there is only **one Pema**. That means:

1. **Announce before you reset.** Pressing Reset demo, or running `npm run demo:e2e` (which resets twice), wipes whatever anyone else is in the middle of. Post "resetting the demo" in the team chat first.
2. **Never change tables in the Supabase dashboard.** Schema changes go in a new file in `supabase/migrations/`, reviewed and pushed by the backend owner (Person 1). Dashboard edits make the database and the code drift apart, and the demo breaks in ways that are hard to trace.
3. **Before a rehearsal or the real demo**, one person resets and everyone else stops clicking.

If you need to experiment freely, ask Person 1 to help you run a private local database with `npm run db:local:start` (needs Docker).

---

## 8. How the code is organised

```text
supabase/migrations/      database tables and SQL functions (booking, accepting a request, confirm, fast-forward, reset)
src/app/                  pages: / , /entrepreneur , /mentor , /ydf
src/app/api/              server endpoints, one folder per action
src/components/           all UI (React + Tailwind)
src/lib/agent/            the agent: runner, handlers, tools, schemas, fallbacks, decision policy
src/lib/matching/         deterministic mentor scoring, who the agent asks next, session times
src/lib/demo/             demo data: mentors, Pema's answers, session notes, Dzongkha message
scripts/demo-e2e.mjs      automatic check of all 14 steps
```

**"I want to change..."**

| ...this | Edit this file |
|---|---|
| Colours, fonts, spacing | `src/app/globals.css` (tokens) and `src/components/ui.tsx` |
| Pema's phone screen | `src/components/entrepreneur-view.tsx` and `src/components/entrepreneur/` |
| Mentor screen | `src/components/mentor-view.tsx` |
| YDF dashboard | `src/components/ydf-view.tsx` |
| Mentors, resources, Pema's starting data | `src/lib/demo/seed-data.ts`, then **Reset demo** |
| Pema's pre-filled answers, session notes, blocker reply | `src/lib/demo/fixtures.ts` |
| The Dzongkha follow-up message | `src/lib/demo/dzongkha.ts` (see section 9) |
| Voice recording (shared by mentor notes and the voice intro) | `src/components/voice/voice-recorder.tsx` (mentor wrapper: `src/components/mentor/voice-note.tsx`) |
| Drafting the assessment from speech | `src/lib/agent/assessment-draft.ts`, `src/lib/agent/assessment-rules.ts` |
| Audio to text (Whisper) | `src/lib/audio/transcribe.ts`, `src/app/api/transcribe/route.ts` |
| What the agent accepts after a session (handover contract) | `src/app/api/session/complete/route.ts`, `SessionCompleteInputSchema` in `src/lib/agent/schemas.ts` |
| Saved AI responses (wording) | `src/lib/agent/fallbacks.ts` |
| How the agent reads replies and picks resource / own mentor / other mentor / escalate | `src/lib/agent/policy.ts` |
| Mentor progress feed and next-session agenda | `src/lib/progress.ts` |
| Pre-filled replies for the demo (on track, obstacle, done) | `src/lib/demo/fixtures.ts` |
| Ranking weights | `src/lib/matching/score-mentor.ts` |
| What each agent event does | `src/lib/agent/handlers.ts` |

If you change seed data, fixtures or ranking, run `npm test`. Some tests check the demo's exact numbers (for example Deki scoring 88), so update them on purpose, not by accident.

## 9. Who does what

| | Agent (Tandin) | Frontend | Calls | Audio to text |
|---|---|---|---|---|
| **Owns** | `src/lib/agent` (including drafting from speech), `src/lib/matching`, `src/lib/progress.ts`, `src/app/api` (except `transcribe`), `supabase/` | `src/components` (except `voice/`, `mentor/voice-note.tsx` and `call/`), `src/app/*/page.tsx`, `globals.css` | New `src/components/call/` (plus one line in each view to show it) | `src/components/voice/`, `src/components/mentor/voice-note.tsx`, `src/lib/audio/`, `src/app/api/transcribe/` |
| **Next task** | Add real transcripts to `evals/extraction-cases.json` and keep `npm run eval:extraction` at 100%; 5 reset-to-finish demo runs | Polish the three views; check the phone layout on a real phone | A "Join call" button on each booking for Pema and the mentor, opening a hosted meeting; offer audio-only | Test voice notes on real phones and microphones; turn a call recording into a transcript |
| **Then** | Tune prompts with real transcripts; watch the `[ai] ... failed validation` lines in the terminal | Backup demo video (Day 2 evening) | Recording consent: both people agree before anything is recorded | Long recordings (over 25 MB): split, transcribe, join; delete audio after use |

If you need to change a file someone else owns, say so at check-in first.

### The handover contract: how calls and audio reach the agent

The agent only needs **text**. When a session ends, send it to the existing endpoint:

```text
POST /api/session/complete
{
  "booking_id": "<uuid of the booking>",
  "notes":      "optional: the mentor's typed or voice-note notes (max 4,000 characters)",
  "transcript": "optional: the full call transcript",
  "source":     "typed" | "voice_note" | "call_recording"
}
```

- Send `notes`, a `transcript`, or both. If neither is sent, you get `400 INVALID_INPUT`.
- Short text is read straight away, and the response includes the result.
- **Long transcripts** (over about 22,000 characters, or 25 minutes of speech) get `202 { "processing": true }`. The agent reads them in the background, and the drafts appear in the Mentor view when ready (a 30-minute call takes about a minute). The hard limit is 200,000 characters, about four hours.
- The agent then extracts SMART draft actions, and the mentor confirms them in the Mentor view, exactly as with typed notes. The Mentor view shows where the text came from.
- To test your part without any AI key, run `E2E_SOURCE=call_recording npm run demo:e2e`. It sends a sample call transcript through the whole demo, plus a 30-minute call through the background flow. Announce the reset first (section 7).
- Need a new database field (for example a meeting link on a booking)? Ask the agent owner for a migration. Never change tables in the dashboard.

### Notes per role

**Frontend, about the assessment form:** `entrepreneur/assessment-form.tsx` now has two modes: the typed form, and the voice flow ("Here is what I understood", the follow-up questions, and "Review or change all answers"). After a voice intro the agent goes ahead by itself: "Assumed" defaults, a 5-second countdown, then the matches; "Change my answers" sits on the recommendations. Keep the labels "Find my mentors", "Use a sample intro", "Try a sample without a business", "Find them now", "Wait, let me check first", "Change my answers" and "Keep my answers", because tests click them.

**Audio to text:** a basic version already works. Start from it, not from scratch.
- **Code:**
  - `VoiceNote` in `src/components/mentor/voice-note.tsx` (record with the browser microphone, or upload)
  - `/api/transcribe` — `mode=voice_note` (plain text) or `mode=call_recording` (audio/video → `[Mentor]` / `[Entrepreneur]` transcript via `src/lib/audio/speakers.ts`). The labels are a **guess from the words** (Groq Whisper cannot tell voices apart), and the response says `labeled: true` or `false`. If the guess cannot finish safely, you get the plain transcript, never an error. For certain speakers, record each person's microphone as a separate track in the call feature.
  - Accepted formats: mp3, m4a, wav, ogg, flac, webm, mp4 (under 25 MB). Others, such as iPhone `.mov`, get `400 UNSUPPORTED_FORMAT` before uploading to Groq.
  - `transcribe()` / `transcribeCallRecording()` in `src/lib/audio/transcribe.ts`, Groq `whisper-large-v3-turbo`, max 25 MB per file
  - Optional local pyannote diarization: `scripts/whisper_diarize.py`
- **Tested:** only by uploading one computer-generated English recording.
- **Not tested yet:** the **Record** button with a real microphone; phones (iPhone Safari records `audio/mp4`, Chrome records `audio/webm`); background noise.
- **Still to decide:** what to tell Dzongkha speakers, since Whisper does not list Dzongkha.
- **Needs live AI on:** `AI_MODE=live` plus `GROQ_API_KEY`.

**Calls:** keep it small.
- Do not build video calling. A hosted meeting link (for example Jitsi Meet, no account needed) is enough.
- Offer audio-only, because rural founders often have weak internet.
- Embedded meetings usually cannot give us their audio. So the simplest recording path is: with both people's consent, the mentor records on their own device and uploads the file through the audio-to-text flow.

**Dzongkha message (any fluent speaker):**
1. Open `src/lib/demo/dzongkha.ts` and write the Dzongkha version of the English message in `dzongkha`.
2. Ideally, have a second fluent speaker read it.
3. Set `verified: true` and fill in `reviewedBy`.

Until then, the app shows English with a "Dzongkha version pending review" label. **Do not paste machine translation.**

**Check-ins:** start of day, lunch, dinner, 15 minutes each. Everyone says: what works, what is blocked, what they are cutting.

## 10. Git workflow

```bash
git pull                          # always, before you start
git switch -c yourname/short-topic
# ...work...
npm test && npm run lint && npm run typecheck
git add -A && git commit -m "Say what changed and why"
git push -u origin yourname/short-topic
```

Then open a pull request on GitHub, or merge at the next check-in.

- **`main` must always be demo-able.** Before merging, the three checks above must pass. For anything touching the agent or the API, also run `npm run demo:e2e`, after announcing the reset.
- Small, frequent commits. Never commit `.env.local`.
- If two people need the same file, say so at check-in first.

## 11. Rules we do not break

From `CLAUDE_WORKING_PLAN.md`. These are what make the agent trustworthy, and judges will probe them.

1. The AI never gets database credentials and never runs SQL. It acts only through the tools in `src/lib/agent/tools.ts`.
2. Mentor ranking is fixed backend rules. The AI only explains the score breakdown and may not invent reasons.
3. Draft actions are not real until a human confirms them.
4. The agent cannot approve credit, payments or mentors, and cannot resolve escalations.
5. The activity log shows short decision factors, never hidden reasoning, prompts or keys.
6. Every AI step has a saved fallback. A slow AI must never stop the demo.
7. Dashboard numbers come from the database. We do not invent impact statistics.
8. No unreviewed Dzongkha on screen.
9. **Out of scope:** real payments, building our own video calling (a link to a hosted meeting is fine), production SMS or WhatsApp, native apps, full translation, multiple agents, vector databases, production login.

## 12. Troubleshooting

| You see | Do this |
|---|---|
| "Connect the database" page | `.env.local` is missing or empty. Redo section 4, then restart `npm run dev` |
| "Invalid API key" in the terminal | You used the masked new-style key. Use the **legacy service_role** key |
| "The demo database is empty" | Click **Load demo data** (announce first, see section 7) |
| "Another next dev server is already running" | Use http://localhost:3000, or stop the old one with `kill <PID shown in the message>` |
| Port 3000 busy | `npx next dev -p 3001` |
| Demo stuck halfway or behaving oddly | YDF view, **Reset demo**, start again |
| A red "That did not work" message | Read the message; it explains the cause (for example "This mentor is fully booked") |
| An agent run shows **Failed** in the activity log | Click **Retry** on it, and tell Person 1 |
| `supabase db push` says "Local database is up to date" | It is aimed at a local Docker database. You almost certainly should not be pushing at all; ask Person 1 |
| Tests fail after changing demo data | Expected if you changed numbers on purpose. Update the test deliberately |
| Header says "AI: saved responses" but you want live | Check `AI_MODE=live` and `GROQ_API_KEY` in `.env.local`, then restart `npm run dev` |
| Some steps show "Saved response" in live mode | Usually the free limit of 8,000 tokens a minute. Wait a minute. The terminal's `[ai]` lines say why |
| Voice note says it needs live AI | Same as above: turn on live AI |

## 13. Using an AI coding assistant (optional)

Claude Code and similar tools work well on this repo. Start any session with the handoff prompt at the bottom of `README.md`. It points the assistant at `CLAUDE_WORKING_PLAN.md` and tells it to check what already exists before changing anything. Review what it changes before you commit.

---

**Stuck for more than 15 minutes?** Ask in the team chat. In a 2.5-day hackathon, asking early is always faster.
