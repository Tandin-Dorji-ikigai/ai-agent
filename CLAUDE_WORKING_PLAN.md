# Claude Working Plan - AI Mentoring Hackathon

## Mission

Build a stable hackathon prototype of an AI-powered mentoring platform within 2.5 days.

The prototype must demonstrate one complete story:

```text
Pema completes a needs assessment
  -> receives three verified mentor recommendations
  -> selects a mentor
  -> uses a simulated YDF sponsorship credit
  -> receives an AI-generated session brief
  -> completes a simulated mentoring session
  -> receives AI-extracted action items
  -> confirms the actions
  -> the demo clock moves forward
  -> one action becomes overdue
  -> the agent asks about the blocker
  -> the agent chooses a next action
  -> the YDF dashboard updates
```

Do not redesign the product or expand its scope. Optimize for a reliable live demonstration.

## Read before working

1. Read `README.md` completely.
2. Read this file completely.
3. Inspect the repository before generating or replacing code.
4. Preserve existing working code.
5. Report any conflict between the repository and this plan before making a large structural change.

## Technology decisions

Use one runtime for application and agent logic:

```text
Next.js + TypeScript
├── User interface
├── Route Handlers / Server Actions
├── Agent runner
├── Agent tools
├── Mentor scoring
├── Fast-forward endpoint
└── Reset-demo endpoint

Supabase
└── Postgres database
```

Do not split agent logic across Next.js and Supabase Edge Functions.

For the prototype:

- Use a demo role switcher for Entrepreneur, Mentor, and YDF.
- Run all privileged database operations on the Next.js server.
- Keep the Supabase service-role key server-only.
- Do not expose secrets through `NEXT_PUBLIC_*` variables.
- Production authentication and complete RLS policies are out of scope unless already working.

## Non-negotiable architecture rules

1. The AI never receives database credentials.
2. The AI never executes SQL.
3. The AI acts only through controlled backend tools.
4. Mentor ranking is deterministic backend code.
5. The AI explains matches only from supplied mentor data and score breakdowns.
6. The AI cannot invent mentors, qualifications, availability, or reasons.
7. Extracted action items are drafts until confirmed by a human.
8. The AI cannot approve credits, funding, payments, or mentors.
9. Do not expose private chain-of-thought. Show concise decision factors and actions instead.
10. Every agent run must be logged.

## Scope

### Must build

- Entrepreneur needs assessment
- Fifteen seeded mentor profiles
- Deterministic mentor scoring
- Top three mentor recommendations
- Evidence-based match explanations
- Mentor selection
- Simulated self-payment and YDF credit options
- Session preparation briefs
- Quick mentor session notes
- AI extraction of draft action items
- Human confirmation of action items
- Fast-forward demo clock
- Overdue-action follow-up
- Agent choice among approved resource, another mentor session, or YDF escalation
- Safe agent activity log
- YDF outcome dashboard
- Reset-demo function
- Saved AI fallbacks for the Pema scenario
- One human-verified Dzongkha message with an English translation

### Must not build

- Real payments
- Real seed-fund disbursement
- Video calling
- Production SMS or WhatsApp
- Native mobile applications
- Full multilingual translation
- Multiple agents
- Vector database
- Microservices
- Advanced analytics
- Complex availability scheduling
- Production identity verification
- Unrequested infrastructure

## Demonstration personas

### Primary entrepreneur

```text
Name: Pema
Location: Outside Thimphu
Business: Community-based tourism
Stage: Early stage
Language: Dzongkha and English
Primary challenge: Customer validation and market positioning
Budget: Limited
Funding path: YDF sponsorship credit
```

### Mentor pool

Seed 15 fictional mentors with meaningful variation:

- Tourism, fintech, marketing, accounting, operations, and product expertise
- Dzongkha and English language combinations
- Different business-stage preferences
- Different fees
- Available and fully booked mentors
- One popular but poorly matched mentor
- One less-visible but strongly matched mentor

The mentor data must make the deterministic ranking visibly useful.

## Mentor scoring

Calculate mentor scores in backend code:

```text
Expertise overlap       35 points
Sector match            20 points
Business-stage match    15 points
Language match          10 points
Availability            10 points
Budget compatibility    10 points
                       ----------
Maximum                 100 points
```

Store the score and breakdown.

Example:

```json
{
  "mentor_id": "uuid",
  "score": 85,
  "score_breakdown": {
    "expertise": 35,
    "sector": 20,
    "business_stage": 15,
    "language": 10,
    "availability": 0,
    "budget": 5
  }
}
```

The match-explanation prompt must contain a rule equivalent to:

```text
Explain this recommendation using only the supplied mentor fields and score
breakdown. Do not infer or invent qualifications, experience, personal traits,
availability, language ability, or suitability factors that are not supplied.
```

## Minimum data model

Implement the schema in `README.md`, with these required tables:

```text
profiles
entrepreneur_profiles
mentor_profiles
mentor_matches
bookings
sessions
action_items
sponsorship_credits
agent_events
agent_runs
escalations
```

Additional demo-support tables are allowed only when necessary. Avoid unnecessary abstractions.

## Agent tools

Implement controlled tools with validated schemas:

### `get_entrepreneur_context`

Returns Pema's structured profile, previous sessions, open actions, and available sponsorship.

### `find_matching_mentors`

Calls deterministic scoring and returns only verified, active mentors.

### `create_booking_request`

Validates the mentor, fee, availability, and selected funding path. It does not process real money.

### `create_session_brief`

Produces structured source data for separate entrepreneur and mentor briefs.

### `extract_action_items`

Extracts a summary and draft action items from session notes. It does not finalize them.

### `update_action_status`

Updates an action only after validating ownership and permitted status transitions.

### `recommend_approved_resource`

Returns only seeded, approved resources. The AI cannot invent links or organizations.

### `suggest_mentor_session`

Suggests a follow-up session but does not create a confirmed booking without user approval.

### `create_escalation`

Creates an open YDF escalation. It cannot resolve or assign the escalation automatically.

## Genuine agent decision

When Pema reports a blocker, the agent must choose one of three actions:

```text
1. Recommend an approved resource
2. Suggest another mentor session
3. Escalate to YDF
```

The decision must use real tool calling.

Show a safe activity entry such as:

```text
Decision: Escalate to YDF

Decision factors:
- The request requires specialist legal expertise.
- No approved resource covers the issue.
- The current mentor does not list legal expertise.

Action:
- Created escalation ESC-102.
```

Do not display hidden reasoning, chain-of-thought, raw prompts, API keys, or internal system messages.

## Suggested project structure

```text
src/
├── app/
│   ├── api/
│   │   ├── assessment/route.ts
│   │   ├── matches/route.ts
│   │   ├── booking/route.ts
│   │   ├── session/complete/route.ts
│   │   ├── actions/confirm/route.ts
│   │   ├── agent/run/route.ts
│   │   └── demo/
│   │       ├── fast-forward/route.ts
│   │       └── reset/route.ts
│   └── ...
│
└── lib/
    ├── agent/
    │   ├── runner.ts
    │   ├── tools.ts
    │   ├── schemas.ts
    │   ├── prompts.ts
    │   └── fallbacks.ts
    ├── matching/
    │   └── score-mentor.ts
    ├── demo/
    │   └── fixtures.ts
    └── supabase/
        ├── server.ts
        └── types.ts

supabase/
├── migrations/
│   ├── 001_schema.sql
│   └── 002_seed_demo.sql
└── seed.sql
```

Adapt this structure to the existing repository. Do not move working files merely to match this example.

## AI fallback policy

Every AI-dependent step in the Pema scenario must have a saved fallback response.

Required fallbacks:

- Assessment summary
- Match explanations
- Entrepreneur session brief
- Mentor session brief
- Extracted action items
- Blocker follow-up
- Agent decision summary
- Dzongkha follow-up message

Execution pattern:

```text
Attempt live AI call
  -> enforce timeout
  -> validate output
  -> if timeout or invalid output, use saved fallback
  -> record `source = live_ai | fallback`
  -> continue the demonstration
```

Fallbacks must preserve the same response schema as live AI results.

## Demo time control

Implement:

```text
POST /api/demo/fast-forward
```

Request:

```json
{
  "days": 5,
  "entrepreneur_id": "uuid"
}
```

The endpoint must:

1. Calculate `demo_now = current time + days`.
2. Find Pema's pending actions due before `demo_now`.
3. Mark the relevant action overdue.
4. Insert an `action.overdue` event.
5. Trigger or queue the agent follow-up.
6. Return the affected action and event IDs.

Do not modify the host or database system clock.

## Demo reset

Implement:

```text
POST /api/demo/reset
```

The reset must restore the known starting state:

- Pema's initial profile and assessment
- Mentor seed data
- Initial YDF credit balance
- No active booking
- No completed session
- No action items
- No open escalations
- No pending demo events

The reset must be repeatable and safe to run between rehearsals.

## YDF dashboard ending

End the demo with a measurable outcome view containing only verified database values:

```text
Credits used
Sessions completed
Action items completed / total
Open escalations
```

Do not invent business-impact statistics.

## Dzongkha moment

Include one short follow-up message in Dzongkha with an English translation.

Requirements:

- The copy must be reviewed by a fluent human teammate.
- Mark it as unverified until that review occurs.
- Do not use unreviewed AI translation during the live demo.

## Work sequence

## Milestone 0 - Repository audit

Before changing code:

1. Inspect the repository structure.
2. Identify the framework and package manager.
3. Inspect existing environment-variable examples.
4. Inspect existing database migrations.
5. Run the current tests, type checks, or build if available.
6. Report what already works.
7. Identify the smallest safe first change.

Do not delete or replace existing code without evidence that it is unused or broken.

## Milestone 1 - End-to-end skeleton

Goal: complete all 14 demo steps with deterministic fixtures or stubs.

Tasks:

1. Create or validate the minimum database schema.
2. Seed Pema, 15 mentors, one YDF credit, and approved resources.
3. Implement deterministic mentor scoring.
4. Create all required API endpoints with stable request/response schemas.
5. Use saved fixture responses for unfinished AI steps.
6. Connect all three user views to the complete journey.
7. Implement demo fast-forward.
8. Implement demo reset.
9. Show the YDF dashboard update.

Exit criteria:

- The full demo works without calling an AI API.
- Reset works twice consecutively.
- Fast-forward reliably creates the overdue action.
- The YDF dashboard shows the final escalation.

This milestone must be completed before polishing individual screens.

## Milestone 2 - Replace critical stubs

Replace fixtures in this order:

1. Needs-assessment summary
2. Mentor-match explanations
3. Session briefs
4. Action extraction
5. Blocker decision and tool call

For every replacement:

- Use structured schemas.
- Add input and output validation.
- Retain the fixture as a fallback.
- Log whether the result came from live AI or fallback.
- Add a focused test.

Exit criteria:

- The blocker decision invokes exactly one permitted action tool.
- The model cannot choose a non-seeded mentor or resource.
- Invalid AI output falls back without breaking the demo.

## Milestone 3 - Reliability

Tasks:

- Add server-side error handling.
- Prevent duplicate event processing.
- Prevent duplicate escalations.
- Prevent negative credit balances.
- Add loading and error states.
- Add a visible but unobtrusive fallback status for debugging.
- Confirm secrets never appear in client bundles or logs.
- Run the demo repeatedly from reset.

Exit criteria:

- Five consecutive reset-to-finish demo runs succeed.
- A failed or slow AI request does not stop the demo.
- Double-clicking an action does not create duplicate records.

## Milestone 4 - Freeze

After the reliability milestone:

- Do not add features.
- Fix only demo-blocking bugs.
- Record a backup demo video.
- Capture backup screenshots.
- Rehearse the presentation.

## Fourteen-step definition of done

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
14. The YDF dashboard updates with credits, session outcome, actions, and escalation.

## Test checklist

### Mentor matching

- Only verified and active mentors are returned.
- A fully booked mentor loses availability points.
- A mentor over budget loses budget points.
- A Dzongkha-speaking tourism mentor ranks appropriately for Pema.
- Explanations contain only factors present in the score breakdown.

### Sponsorship

- A booking cannot deduct more than the remaining credit.
- Repeated requests do not deduct credit twice.
- The final YDF balance matches the booking fee.

### Session and actions

- Session notes produce schema-valid draft actions.
- Draft actions are not final before confirmation.
- Confirmation is idempotent.
- Fast-forward marks the correct action overdue.

### Agent decision

- An approved-resource decision selects a seeded resource.
- A mentor-session decision remains a suggestion until Pema confirms.
- An escalation decision creates one open escalation.
- The activity log shows decision factors, not chain-of-thought.

### Demo operations

- Reset restores the initial state.
- Reset can run repeatedly.
- AI timeout activates the correct fallback.
- Final dashboard values come from the database.

## How Claude should communicate while working

For each implementation increment:

1. State the exact outcome being implemented.
2. List the files that will change.
3. Make the smallest coherent change.
4. Run the relevant checks.
5. Report what passed, what failed, and the next smallest step.

Do not respond with only a large plan after the repository audit. Begin implementing Milestone 1 unless a required credential or destructive decision blocks progress.

## Initial instruction for Claude

Copy and send the following with this file:

```text
Read README.md and CLAUDE_WORKING_PLAN.md completely. Then inspect the repository
without deleting or replacing existing work. Report the current framework, package
manager, implemented features, missing environment variables, and any conflicts
with the working plan.

After the audit, begin Milestone 1 immediately. The first target is a complete
fixture-backed vertical slice of all 14 demo steps, including reset, fast-forward,
and the final YDF dashboard update. Do not start by polishing UI or implementing
production authentication. Preserve fallbacks for every later AI integration.

Work incrementally, validate each change, and keep all agent logic in the Next.js
server runtime. Use Supabase as the database. Never expose the service-role key in
browser code.
```

