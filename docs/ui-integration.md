# MentorFlow screens: how they connect to the backend

The MentorFlow design from PR #2 (`src/components/mentorflow-app.jsx`, shadcn/ui,
TanStack Query) is the app's UI. Every screen uses the real API; the
browser-only preview mode from the PR was retired once the screens were
connected. To work without the shared database, run a local one
(`npm run db:local:start`) and point `.env.local` at it.

- Entrepreneur: `/entrepreneur/connect`, `/entrepreneur/needs`, `/entrepreneur/bookings`, `/entrepreneur/notifications`, `/entrepreneur/call`
- Mentor: `/mentor/dashboard`, `/mentor/requests`, `/mentor/availability`, `/mentor/session`, `/mentor/notifications`, `/mentor/call`
- YDF: `/ydf` (demo controls, metrics, escalations, agent activity)

## The flow (the agent coordinates; people decide)

| Screen | What happens | API |
| --- | --- | --- |
| Needs assessment | Saves the answers, then matches. The agent then asks the best mentor by itself (no button). | `POST /api/assessment`, `POST /api/matches` (and `/api/requests/start` automatically if nobody is being asked) |
| Connect, My bookings | "Asking Deki…", the reply deadline, who is next, how it is paid, and who said no and why. After a yes: the session, the preparation brief and **Join session**. | `GET /api/state` (`request_round`, `booking`) |
| Mentor requests | Need-to-know only (no budget). Accept by picking one of the offered times, or decline with a reason and an optional private note. | `POST /api/requests/accept { request_id, scheduled_at }`, `POST /api/requests/decline { request_id, reason, note? }` |
| My availability | The mentor's usual weekly times; new requests offer the next of these. | `POST /api/mentors/availability { mentor_id, weekly_slots }` |
| Call | LiveKit video and audio, consent, own-microphone recording, uploads, end. | `/api/calls/join`, `/consent`, `/track`, `/end` (see ONBOARDING.md section 9) |
| Session workspace | Notes (or a finished call) become draft actions; the mentor confirms them. | `POST /api/session/complete`, `POST /api/actions/confirm` |
| Notifications | The agent's messages; check-in replies. | `POST /api/inbox/reply`, `POST /api/actions/status` |

Shared state comes from `GET /api/state` through `src/components/demo-state.tsx`
(polled every 4 seconds). Request wording comes from `src/lib/mentorflow-view.ts`
(unit-tested).

## Still to port from the earlier screens

- The voice intro for the needs assessment (speak instead of typing; the agent drafts the answers).
- The mentor's voice note in the session workspace.
- The score breakdown per mentor, and the note that the most-booked mentor ranks low for Pema.
- The mentor's progress feed and next-session agenda (from check-in replies).
- "Ask Deki for a follow-up" after a completed session (`POST /api/requests/ask`).

Their building blocks still exist (`src/components/voice/voice-recorder.tsx`,
`/api/assessment/draft`, `/api/transcribe`).
