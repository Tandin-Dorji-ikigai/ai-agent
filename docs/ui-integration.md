# MentorFlow frontend handoff

The supplied UI is integrated on `feat/ui`. Screens reuse the existing
`src/components/mentorflow-app.jsx`, shadcn/ui controls and prototype theme.
Dropdowns use shadcn Select. TanStack Query manages reads, mutations, errors,
refreshes and polling. No backend routes or database migrations are added.

## Run and test the frontend

Run `npm install` then `npm run dev`. No environment file, database or video
service account is required for the default frontend preview. Open two tabs of
**the same browser and origin** (use localhost or 127.0.0.1 consistently):

- Entrepreneur: `http://localhost:3000/entrepreneur/connect`
- Mentor: `http://localhost:3000/mentor/dashboard`

1. Entrepreneur: edit **Needs assessment** if desired, then **Request this mentor**.
2. Mentor: **Mentor requests**, then **Accept request** or **Decline request**.
3. Mentor: **My availability**. Enter a future date/start/end, then **Save availability**.
   Each row represents one session in Bhutan time (UTC+6).
4. Entrepreneur: **My bookings**. Choose a published time and simulated funding,
   then **Confirm booking**. Both workspaces show the same booking.
5. Open **Video session** in both tabs. Test joined/waiting state, microphone/camera
   control states, shared preview chat and leaving the room.
6. Mentor: **Session workspace**, save notes, review sample actions, then
   **Confirm selected actions**. Entrepreneur: **Notifications**, mark an action complete.
7. **Reset preview** starts over by replacing only browser preview data.

Sample mentors reuse the repository's fictional seed records, including Deki
Wangmo and Sonam Choden. The preview does not read the live database or create
mentor accounts. It starts with Pema's editable sample assessment and no booking.

## Preview storage and boundaries

Data persists under `localStorage` key `mentorflow.frontend.v1`. Storage events
update other tabs; TanStack Query also refreshes on focus and polls every four
seconds. This is one sample pair in one browser. Separate devices need a backend.

- Sign-in and account/application creation remain previews. Credentials, contact
  details and application drafts are not persisted or submitted.
- Funding is simulated; no payment or sponsorship approval occurs.
- Notes are saved locally. Actions are fixed sample suggestions, explicitly
  labelled. No AI extraction runs in frontend mode.
- Call presence and chat sync between tabs. Mic/camera buttons change control
  state; no camera/microphone is opened and no audio/video is transmitted.
- `/ydf` can display preview metrics. Backend agent operations such as
  fast-forward are disabled in this mode.

## Transport seam

`src/lib/frontend-api.ts` defaults to the browser adapter in
`src/lib/frontend-preview.ts`, which never fetches an API. The shared TanStack
Query provider is `src/components/demo-state.tsx`.

After implementing the contracts below, the backend teammate can set
`NEXT_PUBLIC_MENTORFLOW_API_MODE=server` and restart/rebuild. Server mode uses
`src/lib/client-api.ts`. It expects JSON `{ ok: true, ... }` on success, or a
non-success HTTP status with `{ ok: false, code: string, message: string }`.
The old backend alone does not implement the new request/availability contract.
Do not switch modes until that integration is ready. Server secrets must remain
server-side; no secret belongs in a `NEXT_PUBLIC_` variable.

## Required API shape

`FrontendState` in `src/lib/frontend-types.ts` extends the existing `DemoState`
in `src/lib/state-types.ts`. It adds `workflow.current_request` (pending,
accepted, declined or completed), `workflow.availability` (ISO UTC session slots,
with a nullable booking ID) and temporary preview `workflow.call` state.
The authenticated backend should return the role's relevant data in this shape.

| Action | Endpoint and payload |
| --- | --- |
| Load / refresh | `GET /api/state` returns `FrontendState` |
| Save assessment | `POST /api/assessment`: `AssessmentInputSchema` in `src/lib/agent/schemas.ts` |
| Find matches | `POST /api/matches`: `{}` |
| Send request | `POST /api/workflow/request`: `{ mentor_id }` |
| Mentor response | `POST /api/workflow/respond`: `{ request_id, decision: "accepted" or "declined" }` |
| Replace open session times | `POST /api/workflow/availability`: `{ mentor_id, slots: [{ starts_at, ends_at }] }`; preserve reserved times |
| Book session | `POST /api/booking`: `{ mentor_id, request_id, slot_id, funding_type: "ydf_credit" or "self_paid", idempotency_key }` |
| Save notes / extract drafts | `POST /api/session/complete`: `{ booking_id, notes }` |
| Confirm actions | `POST /api/actions/confirm`: `{ session_id, action_ids }` |
| Complete action | `POST /api/actions/status`: `{ action_id, status: "completed" }` |
| Reply to follow-up | `POST /api/inbox/reply`: `{ message_id, body }` |

Successful mutations invalidate the shared query. Booking retries keep the same
idempotency key for the same request, slot and funding choice. Times display in
`Asia/Thimphu`. The backend must enforce authentication, authorization, request
transitions, overlap validation, atomic reservations and payment/credit accounting.
Use the authenticated mentor identity rather than the preview's top-match role.
Return the relevant request/booking so old completed bookings do not replace
new mentor matches.

## Video handoff

The existing call screen includes participant/self placeholders, waiting/joined
states, mic/camera controls, chat and leave. `/api/preview/call` is a browser
adapter action only; there is **no HTTP endpoint** for it, and it is not a video
service API contract.

The video implementation should obtain authorized, short-lived room access for
`booking.id`, connect the selected provider's browser SDK or WebRTC client, bind
local/remote tracks to the existing stage/self-view, bind controls to tracks,
subscribe to participants/chat and release media/room access on leave. Replace
the preview presence mutation/effect and chat action in `mentorflow-app.jsx`.

## Validation

`npm test` covers existing domain behavior, assessment/transport adapters and
frontend requests, responses, scheduling, credit, idempotency, notes/actions,
call presence/chat, persistence and zero-HTTP preview behavior. Run
`npm run typecheck` and `npm run build` for integration checks. The browser
walkthrough uses actual local preview storage across two tabs and blocks any
`/api/` request. `npm run demo:e2e` resets backend data and is unnecessary for
frontend QA.
