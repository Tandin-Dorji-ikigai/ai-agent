-- Beginner coach: for someone with no business idea yet, the agent coaches
-- four short steps (notice problems, talk to three people, pick one idea, try
-- a small test), then hands over to a human mentor with a readiness summary.
-- Additive: older app code keeps working. Linked to profiles, so reset_demo
-- (which deletes profiles) clears it too.

-- One journey per entrepreneur.
create table coach_journeys (
  entrepreneur_id    uuid primary key references profiles (id) on delete cascade,
  -- active: coaching; ready: finished, handed to a mentor; skipped: asked for a mentor straight away
  status             text not null default 'active' check (status in ('active', 'ready', 'skipped')),
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  -- What the mentor sees: problem, who has it, idea, evidence, questions for the mentor.
  readiness_summary  jsonb,
  summary_source     text check (summary_source in ('live_ai', 'fallback', 'system'))
);

-- Each step: the mission the agent set for this person, and what came back.
create table coach_steps (
  id               uuid primary key default gen_random_uuid(),
  entrepreneur_id  uuid not null references profiles (id) on delete cascade,
  step             int not null check (step between 1 and 4),
  mission          text not null,
  why              text,
  done_when        text not null,
  example          text,
  status           text not null default 'open' check (status in ('open', 'done')),
  attempts         int not null default 0,
  last_reply       text,
  feedback         text,
  -- Facts taken from their own replies (never invented), carried into later steps.
  learnings        text[] not null default '{}',
  source           text check (source in ('live_ai', 'fallback', 'system')),
  created_at       timestamptz not null default now(),
  completed_at     timestamptz,
  unique (entrepreneur_id, step)
);
create index coach_steps_entrepreneur_idx on coach_steps (entrepreneur_id, step);

alter table coach_journeys enable row level security;
alter table coach_steps    enable row level security;

-- The coach's agent events.
alter table agent_events drop constraint agent_events_event_type_check;
alter table agent_events add constraint agent_events_event_type_check check (event_type in (
  'assessment.completed',
  'mentor.match.requested',
  'mentor.selected',
  'mentor.request.declined',
  'mentor.request.expired',
  'booking.confirmed',
  'session.completed',
  'action.due_soon',
  'action.overdue',
  'entrepreneur.blocked',
  'checkin.replied',
  'escalation.requested',
  'coach.started',
  'coach.replied'));
