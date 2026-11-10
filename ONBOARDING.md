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
6. A few days later one action is overdue. The agent asks Pema what is blocking her.
7. She needs help with permits, which no approved resource or verified mentor covers, so the agent escalates to YDF.

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
| 2. Switch saved responses to live AI | **Next.** Waiting on the choice of AI provider and an API key |
| 3. Reliability polish | Partly done |
| 4. Freeze: no new features, rehearse, record backup video | End of Day 2 |

"Saved responses" means every AI step currently returns a prepared answer, so the demo works with no AI key and no internet risk. Milestone 2 adds live AI calls that **fall back to those saved answers** if the AI is slow or returns something invalid.

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

Leave `AI_MODE=fixture` for now.

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
npm test          # 34 unit tests, about 1 second
npm run lint
npm run typecheck
```

Then walk through the demo yourself (section 6).

## 5. The secret key: rules

`SUPABASE_SERVICE_ROLE_KEY` can read and write **everything** in our database.

- It lives only in `.env.local`, which git ignores. Never commit it, paste it into chat, or put it in a screenshot.
- Never rename it to `NEXT_PUBLIC_...`. That would send it to every browser.
- Only code under `src/lib` and `src/app/api` (server code) may use it. Browser code never touches the database directly.
- The repository is **public**. Anything committed can be read by anyone.

---

## 6. The demo, click by click (3 minutes)

Use the **Entrepreneur / Mentor / YDF** tabs at the top. The header shows the demo clock and how many of the 14 steps are done.

1. **Entrepreneur:** the form is pre-filled with Pema's answers. **Find my mentors.**
2. Three ranked mentors appear. Open **See the score breakdown**. Read the note about the most-booked mentor.
3. **Choose Deki**, keep **Use my YDF credit**, **Book session**. The prep checklist appears; credit drops to Nu. 1,500.
4. **Mentor:** read the brief, **Complete session**, review the three drafts, **Confirm 3 actions**.
5. **YDF:** **Fast-forward 5 days**. One action becomes overdue and the agent messages Pema.
6. **Entrepreneur:** **Send reply** (pre-filled with the permits problem). The agent escalates: **ESC-101**.
7. **YDF:** metrics, the escalation, and the **Agent activity** log with decision factors and the tools used.
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
supabase/migrations/      database tables and SQL functions (booking, confirm, fast-forward, reset)
src/app/                  pages: / , /entrepreneur , /mentor , /ydf
src/app/api/              server endpoints, one folder per action
src/components/           all UI (React + Tailwind)
src/lib/agent/            the agent: runner, handlers, tools, schemas, fallbacks, decision policy
src/lib/matching/         deterministic mentor scoring
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
| The Dzongkha follow-up message | `src/lib/demo/dzongkha.ts` (see section 9, Person 3) |
| Saved AI responses (wording) | `src/lib/agent/fallbacks.ts` |
| How the agent picks resource / mentor / escalate | `src/lib/agent/policy.ts` |
| Ranking weights | `src/lib/matching/score-mentor.ts` |
| What each agent event does | `src/lib/agent/handlers.ts` |

If you change seed data, fixtures or ranking, run `npm test`. Some tests check the demo's exact numbers (for example Deki scoring 88), so update them on purpose, not by accident.

## 9. Who does what

| | Person 1: agent and backend | Person 2: screens and demo | Person 3: product, data and pitch |
|---|---|---|---|
| **Owns** | `src/lib/agent`, `src/app/api`, `supabase/` | `src/components`, `src/app/*/page.tsx`, `globals.css` | `src/lib/demo`, prompts and wording, slides |
| **Next task** | Milestone 2: live AI behind `aiStep()`, fallbacks kept | Polish the three views; check the phone layout on a real phone | Write and verify the Dzongkha message; interview 2 to 3 founders and 1 mentor for real quotes |
| **Then** | Reliability (Milestone 3) | Record the backup demo video (Day 2 evening) | Slides (8 to 10), demo script, run rehearsals |

**Person 3, the Dzongkha task:** open `src/lib/demo/dzongkha.ts`. Write the Dzongkha version of the English message in `dzongkha`, ideally have a second fluent speaker read it, then set `verified: true` and fill in `reviewedBy`. Until then the app shows English with a "Dzongkha version pending review" label. **Do not paste machine translation.**

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
9. **Out of scope:** real payments, video calls, production SMS or WhatsApp, native apps, full translation, multiple agents, vector databases, production login.

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

## 13. Using an AI coding assistant (optional)

Claude Code and similar tools work well on this repo. Start any session with the handoff prompt at the bottom of `README.md`. It points the assistant at `CLAUDE_WORKING_PLAN.md` and tells it to check what already exists before changing anything. Review what it changes before you commit.

---

**Stuck for more than 15 minutes?** Ask in the team chat. In a 2.5-day hackathon, asking early is always faster.
