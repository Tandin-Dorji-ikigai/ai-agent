-- AI Mentoring Platform: hackathon prototype schema.
-- Source of truth for scope: README.md and CLAUDE_WORKING_PLAN.md.
--
-- Prototype decisions (see CLAUDE_WORKING_PLAN.md, "Technology decisions"):
-- * No Supabase Auth. A demo role switcher replaces login, so profiles do not
--   reference auth.users.
-- * All reads and writes go through the Next.js server with the service-role
--   key. RLS is enabled on every table with NO policies, which denies the
--   anon/authenticated roles entirely; the service role bypasses RLS.
-- * Status columns are text + CHECK rather than enums so they are easy to change
--   during the hackathon.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

create table profiles (
  id                  uuid primary key default gen_random_uuid(),
  role                text not null check (role in ('entrepreneur', 'mentor', 'ydf_admin')),
  full_name           text not null,
  phone               text,
  location            text,
  preferred_language  text not null default 'en' check (preferred_language in ('dz', 'en')),
  created_at          timestamptz not null default now()
);

create table entrepreneur_profiles (
  user_id                  uuid primary key references profiles (id) on delete cascade,
  business_name            text,
  business_stage           text check (business_stage in ('idea', 'early', 'growth', 'established')),
  sector                   text,
  business_description     text,
  primary_challenge        text,
  goals                    text[] not null default '{}',
  expertise_needs          text[] not null default '{}',
  languages                text[] not null default '{}',
  budget                   numeric not null default 0 check (budget >= 0),
  assessment_summary       text,
  assessment_source        text check (assessment_source in ('live_ai', 'fallback')),
  assessment_completed_at  timestamptz,
  updated_at               timestamptz not null default now()
);

create table mentor_profiles (
  user_id               uuid primary key references profiles (id) on delete cascade,
  headline              text,
  bio                   text,
  expertise             text[] not null default '{}',
  sectors               text[] not null default '{}',
  business_stages       text[] not null default '{}',
  languages             text[] not null default '{}',
  fee                   numeric not null check (fee >= 0),
  slots_remaining       integer not null default 0 check (slots_remaining >= 0),
  availability_summary  text,
  sessions_delivered    integer not null default 0 check (sessions_delivered >= 0),
  verified              boolean not null default false,
  active                boolean not null default true,
  updated_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Matching, booking, sessions, actions
-- ---------------------------------------------------------------------------

create table mentor_matches (
  id                  uuid primary key default gen_random_uuid(),
  entrepreneur_id     uuid not null references profiles (id) on delete cascade,
  mentor_id           uuid not null references profiles (id) on delete cascade,
  rank                integer not null check (rank >= 1),
  score               integer not null check (score between 0 and 100),
  score_breakdown     jsonb not null,
  explanation         text,
  explanation_source  text check (explanation_source in ('live_ai', 'fallback')),
  created_at          timestamptz not null default now()
);
create index mentor_matches_entrepreneur_idx on mentor_matches (entrepreneur_id, rank);

create table bookings (
  id                  uuid primary key default gen_random_uuid(),
  entrepreneur_id     uuid not null references profiles (id) on delete cascade,
  mentor_id           uuid not null references profiles (id) on delete cascade,
  scheduled_at        timestamptz not null,
  fee                 numeric not null check (fee >= 0),
  funding_type        text not null check (funding_type in ('self_paid', 'ydf_credit')),
  status              text not null default 'confirmed'
                        check (status in ('pending', 'confirmed', 'completed', 'cancelled')),
  idempotency_key     text not null unique,
  entrepreneur_brief  jsonb,
  mentor_brief        jsonb,
  brief_source        text check (brief_source in ('live_ai', 'fallback')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index bookings_entrepreneur_idx on bookings (entrepreneur_id, created_at desc);

create table sessions (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid not null unique references bookings (id) on delete cascade,
  mentor_notes        text,
  entrepreneur_notes  text,
  agent_summary       text,
  summary_source      text check (summary_source in ('live_ai', 'fallback')),
  summary_confirmed   boolean not null default false,
  completed_at        timestamptz,
  created_at          timestamptz not null default now()
);

create table action_items (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references sessions (id) on delete cascade,
  entrepreneur_id  uuid not null references profiles (id) on delete cascade,
  title            text not null,
  description      text,
  owner            text not null default 'entrepreneur' check (owner in ('entrepreneur', 'mentor')),
  due_in_days      integer not null check (due_in_days between 1 and 60),
  due_at           timestamptz,
  -- 'draft' = extracted by the agent, not yet confirmed by a human.
  status           text not null default 'draft'
                     check (status in ('draft', 'pending', 'completed', 'blocked', 'overdue')),
  blocker          text,
  confirmed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index action_items_entrepreneur_idx on action_items (entrepreneur_id, status);

create table sponsorship_credits (
  id                uuid primary key default gen_random_uuid(),
  entrepreneur_id   uuid not null references profiles (id) on delete cascade,
  amount_granted    numeric not null check (amount_granted >= 0),
  amount_remaining  numeric not null check (amount_remaining >= 0 and amount_remaining <= amount_granted),
  status            text not null default 'active' check (status in ('active', 'exhausted', 'expired', 'revoked')),
  approved_by       uuid references profiles (id),
  expires_at        timestamptz,
  created_at        timestamptz not null default now()
);

-- Approved resources the agent may recommend. The agent cannot invent others.
create table resources (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  title       text not null,
  summary     text not null,
  topics      text[] not null default '{}',
  sectors     text[] not null default '{}',
  format      text,
  approved    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Agent inbox: what the agent (and people) say to the entrepreneur.
create table messages (
  id                 uuid primary key default gen_random_uuid(),
  entrepreneur_id    uuid not null references profiles (id) on delete cascade,
  sender             text not null check (sender in ('agent', 'entrepreneur', 'mentor', 'ydf')),
  kind               text not null default 'info'
                       check (kind in ('info', 'follow_up', 'reply', 'recommendation', 'escalation_notice')),
  body               text not null,
  -- Dzongkha version. Shown only when a fluent teammate has verified it.
  body_dz            text,
  dz_verified        boolean not null default false,
  related_action_id  uuid references action_items (id) on delete set null,
  awaiting_reply     boolean not null default false,
  metadata           jsonb not null default '{}',
  source             text check (source in ('live_ai', 'fallback', 'human', 'system')),
  created_at         timestamptz not null default now()
);
create index messages_entrepreneur_idx on messages (entrepreneur_id, created_at);

create sequence escalation_code_seq start 101;

create table escalations (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique default ('ESC-' || nextval('escalation_code_seq')),
  entrepreneur_id  uuid not null references profiles (id) on delete cascade,
  session_id       uuid references sessions (id) on delete set null,
  action_item_id   uuid references action_items (id) on delete set null,
  reason           text not null check (reason in ('specialist_required', 'safeguarding', 'dispute', 'other')),
  summary          text not null,
  priority         text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status           text not null default 'open' check (status in ('open', 'assigned', 'resolved')),
  assigned_to      uuid references profiles (id),
  created_at       timestamptz not null default now()
);
-- At most one unresolved escalation per action item (prevents duplicates).
create unique index escalations_one_open_per_action
  on escalations (action_item_id)
  where status <> 'resolved' and action_item_id is not null;

-- ---------------------------------------------------------------------------
-- Agent events and runs
-- ---------------------------------------------------------------------------

create table agent_events (
  id               uuid primary key default gen_random_uuid(),
  event_type       text not null check (event_type in (
                     'assessment.completed',
                     'mentor.match.requested',
                     'mentor.selected',
                     'booking.confirmed',
                     'session.completed',
                     'action.due_soon',
                     'action.overdue',
                     'entrepreneur.blocked',
                     'escalation.requested')),
  entity_type      text not null,
  entity_id        uuid,
  entrepreneur_id  uuid references profiles (id) on delete cascade,
  payload          jsonb not null default '{}',
  status           text not null default 'pending'
                     check (status in ('pending', 'processing', 'completed', 'failed')),
  -- Same key = same event. Prevents duplicate processing on double clicks.
  dedupe_key       text unique,
  scheduled_for    timestamptz not null default now(),
  attempts         integer not null default 0,
  error            text,
  created_at       timestamptz not null default now(),
  processed_at     timestamptz
);
create index agent_events_status_idx on agent_events (status, scheduled_for);

create table agent_runs (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid references agent_events (id) on delete set null,
  entrepreneur_id   uuid references profiles (id) on delete cascade,
  trigger           text not null,
  input_summary     text,
  -- [{ tool, input, ok, summary }]. Never contains secrets or raw prompts.
  tools_called      jsonb not null default '[]',
  decision          text,
  -- Short, human-readable decision factors. Never chain-of-thought.
  decision_factors  jsonb not null default '[]',
  final_output      text,
  source            text check (source in ('live_ai', 'fallback')),
  status            text not null default 'running' check (status in ('running', 'completed', 'failed')),
  error             text,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz
);
create index agent_runs_created_idx on agent_runs (created_at desc);

-- ---------------------------------------------------------------------------
-- Demo clock: one row. The app reads "now" through demo_now().
-- ---------------------------------------------------------------------------

create table demo_state (
  id                 integer primary key default 1 check (id = 1),
  clock_offset_days  integer not null default 0 check (clock_offset_days between 0 and 365),
  updated_at         timestamptz not null default now()
);
insert into demo_state (id, clock_offset_days) values (1, 0);

-- ---------------------------------------------------------------------------
-- Row Level Security: enabled everywhere, no policies (server-only access).
-- ---------------------------------------------------------------------------

alter table profiles              enable row level security;
alter table entrepreneur_profiles enable row level security;
alter table mentor_profiles       enable row level security;
alter table mentor_matches        enable row level security;
alter table bookings              enable row level security;
alter table sessions              enable row level security;
alter table action_items          enable row level security;
alter table sponsorship_credits   enable row level security;
alter table resources             enable row level security;
alter table messages              enable row level security;
alter table escalations           enable row level security;
alter table agent_events          enable row level security;
alter table agent_runs            enable row level security;
alter table demo_state            enable row level security;
