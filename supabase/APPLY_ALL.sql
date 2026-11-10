-- GENERATED FILE. Do not edit by hand: run `npm run db:apply-all`.
-- Every migration in supabase/migrations/, in order, for pasting into the
-- Supabase SQL Editor on a NEW, empty project. On an existing project, use
-- `npx supabase db push` instead (it applies only the missing migrations).
-- Includes: 20261110000001_schema.sql, 20261110000002_demo_functions.sql, 20261110000003_checkin_loop.sql, 20261110000004_session_sources.sql, 20261110000005_mentor_requests.sql, 20261110000006_calls.sql, 20261111000007_livekit_calls.sql, 20261111000008_push_subscriptions.sql, 20261111000009_beginner_coach.sql

-- ===== 20261110000001_schema.sql =====
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

-- ===== 20261110000002_demo_functions.sql =====
-- Atomic operations the Next.js server calls through supabase.rpc().
-- Each one runs in a single transaction, so a half-finished booking, a
-- double credit deduction or a half-reset demo cannot happen.
--
-- All functions are SECURITY DEFINER with a fixed search_path, and EXECUTE is
-- granted to service_role only (revoked from public/anon/authenticated).

-- ---------------------------------------------------------------------------
-- demo_now(): the single source of "current time" for the demo.
-- ---------------------------------------------------------------------------
create or replace function demo_now()
returns timestamptz
language sql
stable
set search_path = public, pg_temp
as $$
  select now() + make_interval(days => coalesce(
    (select clock_offset_days from demo_state where id = 1), 0));
$$;

-- ---------------------------------------------------------------------------
-- create_booking: validates mentor, availability and funding, deducts credit
-- and a mentor slot, and creates the booking. Idempotent on p_idempotency_key.
-- Raises one of: MENTOR_NOT_BOOKABLE, MENTOR_FULLY_BOOKED,
-- BOOKING_ALREADY_ACTIVE, NO_ACTIVE_CREDIT, INSUFFICIENT_CREDIT,
-- INVALID_FUNDING_TYPE, ENTREPRENEUR_NOT_FOUND.
-- ---------------------------------------------------------------------------
create or replace function create_booking(
  p_entrepreneur_id  uuid,
  p_mentor_id        uuid,
  p_funding_type     text,
  p_idempotency_key  text
)
returns bookings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing  bookings;
  v_mentor    mentor_profiles;
  v_credit    sponsorship_credits;
  v_booking   bookings;
begin
  if not exists (select 1 from profiles where id = p_entrepreneur_id and role = 'entrepreneur') then
    raise exception 'ENTREPRENEUR_NOT_FOUND';
  end if;

  -- Lock the mentor first so concurrent requests serialise here.
  select * into v_mentor from mentor_profiles where user_id = p_mentor_id for update;

  -- Idempotency check AFTER the lock, so a concurrent duplicate sees the
  -- first request's committed booking and returns it.
  select * into v_existing from bookings where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  if v_mentor.user_id is null or not v_mentor.verified or not v_mentor.active then
    raise exception 'MENTOR_NOT_BOOKABLE';
  end if;
  if v_mentor.slots_remaining < 1 then
    raise exception 'MENTOR_FULLY_BOOKED';
  end if;
  if exists (
    select 1 from bookings
    where entrepreneur_id = p_entrepreneur_id
      and mentor_id = p_mentor_id
      and status in ('pending', 'confirmed')
  ) then
    raise exception 'BOOKING_ALREADY_ACTIVE';
  end if;

  if p_funding_type = 'ydf_credit' then
    select * into v_credit
    from sponsorship_credits
    where entrepreneur_id = p_entrepreneur_id
      and status = 'active'
      and (expires_at is null or expires_at > demo_now())
    order by created_at
    limit 1
    for update;
    if not found then
      raise exception 'NO_ACTIVE_CREDIT';
    end if;
    if v_credit.amount_remaining < v_mentor.fee then
      raise exception 'INSUFFICIENT_CREDIT';
    end if;
    update sponsorship_credits
    set amount_remaining = amount_remaining - v_mentor.fee,
        status = case when amount_remaining - v_mentor.fee = 0 then 'exhausted' else status end
    where id = v_credit.id;
  elsif p_funding_type <> 'self_paid' then
    raise exception 'INVALID_FUNDING_TYPE';
  end if;
  -- self_paid: payment is simulated; no money moves in this prototype.

  update mentor_profiles
  set slots_remaining = slots_remaining - 1, updated_at = now()
  where user_id = p_mentor_id;

  insert into bookings (
    entrepreneur_id, mentor_id, scheduled_at, fee, funding_type, status,
    idempotency_key, created_at, updated_at
  )
  values (
    p_entrepreneur_id, p_mentor_id, demo_now() + interval '2 days', v_mentor.fee,
    p_funding_type, 'confirmed', p_idempotency_key, demo_now(), demo_now()
  )
  returning * into v_booking;

  return v_booking;
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_action_items: a human confirms the agent's draft actions.
-- Selected drafts become 'pending' with a due date on the demo clock;
-- unselected drafts are discarded. Idempotent: a second call changes nothing.
-- ---------------------------------------------------------------------------
create or replace function confirm_action_items(
  p_session_id  uuid,
  p_action_ids  uuid[]
)
returns setof action_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from sessions where id = p_session_id) then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  delete from action_items
  where session_id = p_session_id
    and status = 'draft'
    and not (id = any (p_action_ids));

  update action_items
  set status = 'pending',
      due_at = demo_now() + make_interval(days => due_in_days),
      confirmed_at = demo_now(),
      updated_at = now()
  where session_id = p_session_id
    and status = 'draft'
    and id = any (p_action_ids);

  update sessions set summary_confirmed = true where id = p_session_id;

  return query
    select * from action_items
    where session_id = p_session_id and status <> 'draft'
    order by due_at, created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- fast_forward_demo: advances the demo clock and marks the entrepreneur's
-- pending actions overdue. Never touches the real system clock.
-- Returns { demo_now, overdue_action_ids }.
-- ---------------------------------------------------------------------------
create or replace function fast_forward_demo(
  p_days             integer,
  p_entrepreneur_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offset    integer;
  v_now       timestamptz;
  v_overdue   uuid[];
begin
  if p_days < 1 or p_days > 30 then
    raise exception 'INVALID_DAYS';
  end if;

  update demo_state
  set clock_offset_days = clock_offset_days + p_days, updated_at = now()
  where id = 1
  returning clock_offset_days into v_offset;

  v_now := now() + make_interval(days => v_offset);

  with changed as (
    update action_items
    set status = 'overdue', updated_at = now()
    where entrepreneur_id = p_entrepreneur_id
      and status = 'pending'
      and due_at < v_now
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_overdue from changed;

  return jsonb_build_object(
    'demo_now', v_now,
    'clock_offset_days', v_offset,
    'overdue_action_ids', to_jsonb(v_overdue)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- reset_demo: wipes all demo data and re-seeds it in ONE transaction.
-- The seed itself is passed in as JSON from src/lib/demo/seed-data.ts, which is
-- the single source of truth (also used by the unit tests).
-- ---------------------------------------------------------------------------
create or replace function reset_demo(p_seed jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from messages where true;
  delete from escalations where true;
  delete from agent_runs where true;
  delete from agent_events where true;
  delete from action_items where true;
  delete from sessions where true;
  delete from bookings where true;
  delete from mentor_matches where true;
  delete from sponsorship_credits where true;
  delete from resources where true;
  delete from entrepreneur_profiles where true;
  delete from mentor_profiles where true;
  delete from profiles where true;

  perform setval('escalation_code_seq', 101, false);

  insert into demo_state (id, clock_offset_days, updated_at)
  values (1, 0, now())
  on conflict (id) do update set clock_offset_days = 0, updated_at = now();

  insert into profiles (id, role, full_name, phone, location, preferred_language)
  select id, role, full_name, phone, location, preferred_language
  from jsonb_populate_recordset(null::profiles, p_seed -> 'profiles');

  insert into entrepreneur_profiles (user_id, business_name, languages, budget)
  select user_id, business_name, coalesce(languages, '{}'), coalesce(budget, 0)
  from jsonb_populate_recordset(null::entrepreneur_profiles, p_seed -> 'entrepreneur_profiles');

  insert into mentor_profiles (
    user_id, headline, bio, expertise, sectors, business_stages, languages, fee,
    slots_remaining, availability_summary, sessions_delivered, verified, active
  )
  select
    user_id, headline, bio, expertise, sectors, business_stages, languages, fee,
    slots_remaining, availability_summary, sessions_delivered, verified, active
  from jsonb_populate_recordset(null::mentor_profiles, p_seed -> 'mentor_profiles');

  insert into resources (id, slug, title, summary, topics, sectors, format, approved)
  select id, slug, title, summary, topics, coalesce(sectors, '{}'), format, approved
  from jsonb_populate_recordset(null::resources, p_seed -> 'resources');

  insert into sponsorship_credits (
    id, entrepreneur_id, amount_granted, amount_remaining, status, approved_by, expires_at
  )
  select
    id, entrepreneur_id, amount_granted, amount_granted, 'active', approved_by,
    now() + interval '90 days'
  from jsonb_populate_recordset(null::sponsorship_credits, p_seed -> 'sponsorship_credits');

  return jsonb_build_object(
    'profiles', (select count(*) from profiles),
    'mentors', (select count(*) from mentor_profiles),
    'resources', (select count(*) from resources),
    'credits', (select count(*) from sponsorship_credits)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions: only the server (service_role) may call these.
-- ---------------------------------------------------------------------------
revoke execute on function demo_now() from public, anon, authenticated;
revoke execute on function create_booking(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function confirm_action_items(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function fast_forward_demo(integer, uuid) from public, anon, authenticated;
revoke execute on function reset_demo(jsonb) from public, anon, authenticated;

grant execute on function demo_now() to service_role;
grant execute on function create_booking(uuid, uuid, text, text) to service_role;
grant execute on function confirm_action_items(uuid, uuid[]) to service_role;
grant execute on function fast_forward_demo(integer, uuid) to service_role;
grant execute on function reset_demo(jsonb) to service_role;

-- ===== 20261110000003_checkin_loop.sql =====
-- Check-in loop from the team workflow ("post-session mentoring follow-up"):
--   SMART tasks -> scheduled check-ins -> mentee reply -> progress status
--   (on track / done / stuck without help / stuck needing help)
--   -> progress feed for the mentor -> agenda for the next session.
--
-- Additive and backward compatible: older app code keeps working.

-- SMART: how we will know the action is done, plus check-in scheduling.
alter table action_items
  add column success_measure   text,
  add column next_check_in_at  timestamptz,
  add column last_check_in_at  timestamptz;

-- New message kind for scheduled progress check-ins.
alter table messages drop constraint messages_kind_check;
alter table messages add constraint messages_kind_check
  check (kind in ('info', 'follow_up', 'check_in', 'reply', 'recommendation', 'escalation_notice'));

-- New event: the mentee replied to a check-in or follow-up.
alter table agent_events drop constraint agent_events_event_type_check;
alter table agent_events add constraint agent_events_event_type_check check (event_type in (
  'assessment.completed',
  'mentor.match.requested',
  'mentor.selected',
  'booking.confirmed',
  'session.completed',
  'action.due_soon',
  'action.overdue',
  'entrepreneur.blocked',
  'checkin.replied',
  'escalation.requested'));

-- Progress feed ("add to mentor progress"). Items with agenda = true are
-- carried into the next session's brief.
create table progress_updates (
  id               uuid primary key default gen_random_uuid(),
  entrepreneur_id  uuid not null references profiles (id) on delete cascade,
  action_item_id   uuid references action_items (id) on delete cascade,
  kind             text not null check (kind in (
                     'on_track', 'done', 'obstacle', 'help_requested',
                     'resource_recommended', 'mentor_requested',
                     'mentor_session_suggested', 'escalated')),
  note             text,
  agenda           boolean not null default false,
  source           text check (source in ('live_ai', 'fallback', 'human', 'system')),
  created_at       timestamptz not null default now()
);
create index progress_updates_entrepreneur_idx on progress_updates (entrepreneur_id, created_at);
alter table progress_updates enable row level security;

-- ---------------------------------------------------------------------------
-- confirm_action_items: now also schedules the first check-in,
-- two days before the due date (but at least one day after confirmation).
-- ---------------------------------------------------------------------------
create or replace function confirm_action_items(
  p_session_id  uuid,
  p_action_ids  uuid[]
)
returns setof action_items
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := demo_now();
begin
  if not exists (select 1 from sessions where id = p_session_id) then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  delete from action_items
  where session_id = p_session_id
    and status = 'draft'
    and not (id = any (p_action_ids));

  update action_items
  set status = 'pending',
      due_at = v_now + make_interval(days => due_in_days),
      next_check_in_at = greatest(
        v_now + interval '1 day',
        v_now + make_interval(days => due_in_days) - interval '2 days'),
      confirmed_at = v_now,
      updated_at = now()
  where session_id = p_session_id
    and status = 'draft'
    and id = any (p_action_ids);

  update sessions set summary_confirmed = true where id = p_session_id;

  return query
    select * from action_items
    where session_id = p_session_id and status <> 'draft'
    order by due_at, created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- fast_forward_demo: advances the demo clock, marks actions overdue, and
-- returns which actions now need a scheduled check-in.
-- Returns { demo_now, clock_offset_days, overdue_action_ids, check_ins: [{id, at}] }.
-- ---------------------------------------------------------------------------
create or replace function fast_forward_demo(
  p_days             integer,
  p_entrepreneur_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_offset    integer;
  v_now       timestamptz;
  v_overdue   uuid[];
  v_check_ins jsonb;
begin
  if p_days < 1 or p_days > 30 then
    raise exception 'INVALID_DAYS';
  end if;

  update demo_state
  set clock_offset_days = clock_offset_days + p_days, updated_at = now()
  where id = 1
  returning clock_offset_days into v_offset;

  v_now := now() + make_interval(days => v_offset);

  with changed as (
    update action_items
    set status = 'overdue', next_check_in_at = null, updated_at = now()
    where entrepreneur_id = p_entrepreneur_id
      and status = 'pending'
      and due_at < v_now
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_overdue from changed;

  -- Scheduled check-ins that are now due (overdue ones get a follow-up instead).
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'at', next_check_in_at) order by due_at), '[]'::jsonb)
  into v_check_ins
  from action_items
  where entrepreneur_id = p_entrepreneur_id
    and status in ('pending', 'overdue', 'blocked')
    and next_check_in_at is not null
    and next_check_in_at <= v_now
    and not (id = any (v_overdue));

  return jsonb_build_object(
    'demo_now', v_now,
    'clock_offset_days', v_offset,
    'overdue_action_ids', to_jsonb(v_overdue),
    'check_ins', v_check_ins
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- reset_demo: same as before, plus the new progress_updates table.
-- ---------------------------------------------------------------------------
create or replace function reset_demo(p_seed jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from progress_updates where true;
  delete from messages where true;
  delete from escalations where true;
  delete from agent_runs where true;
  delete from agent_events where true;
  delete from action_items where true;
  delete from sessions where true;
  delete from bookings where true;
  delete from mentor_matches where true;
  delete from sponsorship_credits where true;
  delete from resources where true;
  delete from entrepreneur_profiles where true;
  delete from mentor_profiles where true;
  delete from profiles where true;

  perform setval('escalation_code_seq', 101, false);

  insert into demo_state (id, clock_offset_days, updated_at)
  values (1, 0, now())
  on conflict (id) do update set clock_offset_days = 0, updated_at = now();

  insert into profiles (id, role, full_name, phone, location, preferred_language)
  select id, role, full_name, phone, location, preferred_language
  from jsonb_populate_recordset(null::profiles, p_seed -> 'profiles');

  insert into entrepreneur_profiles (user_id, business_name, languages, budget)
  select user_id, business_name, coalesce(languages, '{}'), coalesce(budget, 0)
  from jsonb_populate_recordset(null::entrepreneur_profiles, p_seed -> 'entrepreneur_profiles');

  insert into mentor_profiles (
    user_id, headline, bio, expertise, sectors, business_stages, languages, fee,
    slots_remaining, availability_summary, sessions_delivered, verified, active
  )
  select
    user_id, headline, bio, expertise, sectors, business_stages, languages, fee,
    slots_remaining, availability_summary, sessions_delivered, verified, active
  from jsonb_populate_recordset(null::mentor_profiles, p_seed -> 'mentor_profiles');

  insert into resources (id, slug, title, summary, topics, sectors, format, approved)
  select id, slug, title, summary, topics, coalesce(sectors, '{}'), format, approved
  from jsonb_populate_recordset(null::resources, p_seed -> 'resources');

  insert into sponsorship_credits (
    id, entrepreneur_id, amount_granted, amount_remaining, status, approved_by, expires_at
  )
  select
    id, entrepreneur_id, amount_granted, amount_granted, 'active', approved_by,
    now() + interval '90 days'
  from jsonb_populate_recordset(null::sponsorship_credits, p_seed -> 'sponsorship_credits');

  return jsonb_build_object(
    'profiles', (select count(*) from profiles),
    'mentors', (select count(*) from mentor_profiles),
    'resources', (select count(*) from resources),
    'credits', (select count(*) from sponsorship_credits)
  );
end;
$$;

-- ===== 20261110000004_session_sources.sql =====
-- Handover contract between the call / audio-to-text work and the agent:
-- where a session's text came from, and the full call transcript if any.
-- Additive: existing rows default to 'typed'; older app code keeps working.

alter table sessions
  add column notes_source text not null default 'typed'
    check (notes_source in ('typed', 'voice_note', 'call_recording')),
  add column transcript text;

-- ===== 20261110000005_mentor_requests.sql =====
-- Mentor requests: the agent asks a mentor, the mentor decides.
--
--   matching -> agent sends a request to the best bookable mentor
--   -> mentor accepts (picks one of their own times) or declines
--   -> accepted: booking at that time, YDF credit used only now
--   -> declined or no reply in 2 days: the agent asks the next best mentor
--   -> after 3 mentors without a yes: escalated to YDF
--
-- Additive and backward compatible: older app code keeps working.

-- When each mentor is usually free, in Bhutan time (UTC+6).
-- [{ "day": "tue", "time": "17:30" }, ...]
alter table mentor_profiles
  add column weekly_slots jsonb not null default '[]';

create table mentor_requests (
  id               uuid primary key default gen_random_uuid(),
  entrepreneur_id  uuid not null references profiles (id) on delete cascade,
  mentor_id        uuid not null references profiles (id) on delete cascade,
  -- One "round" = the agent's attempts to find a mentor for one need.
  round_id         uuid not null,
  attempt          integer not null check (attempt between 1 and 10),
  -- 'match': the agent picked the mentor from the ranking.
  -- 'direct': the mentee asked for this mentor (follow-up or a suggestion).
  kind             text not null default 'match' check (kind in ('match', 'direct')),
  score            integer check (score between 0 and 100),
  funding_type     text not null check (funding_type in ('self_paid', 'ydf_credit')),
  fee              numeric not null check (fee >= 0),
  -- What the mentor sees: need-to-know only (no phone, no budget).
  mentee_summary   jsonb not null,
  -- The concrete times the mentor can choose from when accepting.
  offered_slots    timestamptz[] not null default '{}',
  status           text not null default 'pending'
                     check (status in ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  decline_reason   text check (decline_reason in ('no_time', 'not_my_area', 'other')),
  -- The mentor's own words. Seen by the agent and YDF, not by the mentee.
  decline_note     text,
  scheduled_at     timestamptz,
  booking_id       uuid references bookings (id) on delete set null,
  expires_at       timestamptz not null,
  responded_at     timestamptz,
  created_at       timestamptz not null default now()
);
-- At most one open request per mentee, and each mentor asked once per round.
create unique index mentor_requests_one_pending on mentor_requests (entrepreneur_id) where status = 'pending';
create unique index mentor_requests_once_per_round on mentor_requests (round_id, mentor_id);
create index mentor_requests_mentor_idx on mentor_requests (mentor_id, status);
create index mentor_requests_entrepreneur_idx on mentor_requests (entrepreneur_id, created_at);
alter table mentor_requests enable row level security;

-- New events: a mentor declined, or a request expired without a reply.
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
  'escalation.requested'));

-- New escalation reason: no mentor said yes.
alter table escalations drop constraint escalations_reason_check;
alter table escalations add constraint escalations_reason_check
  check (reason in ('specialist_required', 'safeguarding', 'dispute', 'no_mentor_available', 'other'));

-- ---------------------------------------------------------------------------
-- accept_mentor_request: the mentor says yes and picks one of the offered
-- times. Books the session (create_booking: credit and slot checks, credit
-- deducted now and only now) at that time, in one transaction.
-- Idempotent: accepting the same request again returns the same booking.
-- Raises REQUEST_NOT_FOUND, REQUEST_NOT_PENDING, REQUEST_EXPIRED,
-- SLOT_NOT_OFFERED, SLOT_IN_PAST, or any create_booking error.
-- Returns { request_id, booking_id, scheduled_at }.
-- ---------------------------------------------------------------------------
create or replace function accept_mentor_request(
  p_request_id    uuid,
  p_scheduled_at  timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req      mentor_requests;
  v_booking  bookings;
begin
  select * into v_req from mentor_requests where id = p_request_id for update;
  if not found then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  if v_req.status = 'accepted' and v_req.booking_id is not null then
    return jsonb_build_object('request_id', v_req.id, 'booking_id', v_req.booking_id, 'scheduled_at', v_req.scheduled_at);
  end if;
  if v_req.status <> 'pending' then
    raise exception 'REQUEST_NOT_PENDING';
  end if;
  if v_req.expires_at <= demo_now() then
    raise exception 'REQUEST_EXPIRED';
  end if;
  if not (p_scheduled_at = any (v_req.offered_slots)) then
    raise exception 'SLOT_NOT_OFFERED';
  end if;
  if p_scheduled_at <= demo_now() then
    raise exception 'SLOT_IN_PAST';
  end if;

  v_booking := create_booking(
    v_req.entrepreneur_id, v_req.mentor_id, v_req.funding_type, 'request:' || v_req.id::text);

  update bookings
  set scheduled_at = p_scheduled_at, updated_at = demo_now()
  where id = v_booking.id;

  update mentor_requests
  set status = 'accepted',
      scheduled_at = p_scheduled_at,
      booking_id = v_booking.id,
      responded_at = demo_now()
  where id = v_req.id;

  return jsonb_build_object('request_id', v_req.id, 'booking_id', v_booking.id, 'scheduled_at', p_scheduled_at);
end;
$$;

revoke execute on function accept_mentor_request(uuid, timestamptz) from public, anon, authenticated;
grant execute on function accept_mentor_request(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- reset_demo: same as before, plus mentor requests and weekly times.
-- ---------------------------------------------------------------------------
create or replace function reset_demo(p_seed jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from mentor_requests where true;
  delete from progress_updates where true;
  delete from messages where true;
  delete from escalations where true;
  delete from agent_runs where true;
  delete from agent_events where true;
  delete from action_items where true;
  delete from sessions where true;
  delete from bookings where true;
  delete from mentor_matches where true;
  delete from sponsorship_credits where true;
  delete from resources where true;
  delete from entrepreneur_profiles where true;
  delete from mentor_profiles where true;
  delete from profiles where true;

  perform setval('escalation_code_seq', 101, false);

  insert into demo_state (id, clock_offset_days, updated_at)
  values (1, 0, now())
  on conflict (id) do update set clock_offset_days = 0, updated_at = now();

  insert into profiles (id, role, full_name, phone, location, preferred_language)
  select id, role, full_name, phone, location, preferred_language
  from jsonb_populate_recordset(null::profiles, p_seed -> 'profiles');

  insert into entrepreneur_profiles (user_id, business_name, languages, budget)
  select user_id, business_name, coalesce(languages, '{}'), coalesce(budget, 0)
  from jsonb_populate_recordset(null::entrepreneur_profiles, p_seed -> 'entrepreneur_profiles');

  insert into mentor_profiles (
    user_id, headline, bio, expertise, sectors, business_stages, languages, fee,
    slots_remaining, availability_summary, weekly_slots, sessions_delivered, verified, active
  )
  select
    user_id, headline, bio, expertise, sectors, business_stages, languages, fee,
    slots_remaining, availability_summary, coalesce(weekly_slots, '[]'::jsonb),
    sessions_delivered, verified, active
  from jsonb_populate_recordset(null::mentor_profiles, p_seed -> 'mentor_profiles');

  insert into resources (id, slug, title, summary, topics, sectors, format, approved)
  select id, slug, title, summary, topics, coalesce(sectors, '{}'), format, approved
  from jsonb_populate_recordset(null::resources, p_seed -> 'resources');

  insert into sponsorship_credits (
    id, entrepreneur_id, amount_granted, amount_remaining, status, approved_by, expires_at
  )
  select
    id, entrepreneur_id, amount_granted, amount_granted, 'active', approved_by,
    now() + interval '90 days'
  from jsonb_populate_recordset(null::sponsorship_credits, p_seed -> 'sponsorship_credits');

  return jsonb_build_object(
    'profiles', (select count(*) from profiles),
    'mentors', (select count(*) from mentor_profiles),
    'resources', (select count(*) from resources),
    'credits', (select count(*) from sponsorship_credits)
  );
end;
$$;

-- ===== 20261110000006_calls.sql =====
-- Video and audio calls for a booked session.
--
-- Rules (agreed by the team):
--   * a call exists only for a CONFIRMED booking, one room per booking;
--   * only the booking's mentor and entrepreneur can join;
--   * the room closes when the session completes; no call when cancelled.
--
-- Transcripts with certain speakers: each person's browser records only its
-- own microphone, after BOTH people agree, and uploads it in parts. Each part
-- is transcribed and the audio is thrown away (only text is stored). When the
-- call ends, the parts are merged by time into [Mentor] / [Entrepreneur]
-- turns, and the agent reads that transcript like any other session.
--
-- Additive: older app code keeps working.

create table calls (
  id                       uuid primary key default gen_random_uuid(),
  booking_id               uuid not null unique references bookings (id) on delete cascade,
  -- 'daily' = an embedded Daily room; 'none' = no video provider configured
  -- (recording and transcripts still work, e.g. for tests or in-person sessions).
  provider                 text not null check (provider in ('daily', 'none')),
  -- Random and unguessable: knowing the booking id is not enough to join.
  room_name                text not null unique,
  room_url                 text,
  status                   text not null default 'open' check (status in ('open', 'ended')),
  mentor_joined_at         timestamptz,
  entrepreneur_joined_at   timestamptz,
  -- Recording starts only when both have agreed.
  mentor_consent_at        timestamptz,
  entrepreneur_consent_at  timestamptz,
  -- Each side says it has finished (its last part is uploaded).
  mentor_done_at           timestamptz,
  entrepreneur_done_at     timestamptz,
  -- Set once the merged transcript has been handed to the agent.
  transcript_built_at      timestamptz,
  ended_at                 timestamptz,
  created_at               timestamptz not null default now()
);

create table call_track_parts (
  id           uuid primary key default gen_random_uuid(),
  call_id      uuid not null references calls (id) on delete cascade,
  role         text not null check (role in ('mentor', 'entrepreneur')),
  part         integer not null check (part between 0 and 500),
  -- When this part's recording started, in SERVER time (the join response
  -- gives the client the server's clock, so two devices line up).
  started_at   timestamptz not null,
  -- Whisper segments: [{ start, end, text, avg_logprob?, no_speech_prob? }]
  -- (seconds from started_at). No audio is ever stored.
  segments     jsonb not null default '[]',
  source       text check (source in ('live_ai', 'fallback')),
  created_at   timestamptz not null default now(),
  unique (call_id, role, part)
);
create index call_track_parts_call_idx on call_track_parts (call_id, role, part);

alter table calls            enable row level security;
alter table call_track_parts enable row level security;

-- ===== 20261111000007_livekit_calls.sql =====
-- Calls switch from Daily to LiveKit (Daily needs a card on file before anyone
-- can join; LiveKit Cloud's free plan does not). 'daily' stays allowed so any
-- existing rows remain valid. Additive: older app code keeps working.

alter table calls drop constraint calls_provider_check;
alter table calls add constraint calls_provider_check check (provider in ('livekit', 'daily', 'none'));

-- ===== 20261111000008_push_subscriptions.sql =====
-- Web push: phones that asked to be told when the other person joins a call.
-- Kept by ROLE, because the hosted test version signs in by role (not personal
-- accounts): every phone signed in as the mentor is told when Pema joins, and
-- the other way round. Not demo data, so reset_demo leaves it alone and phones
-- stay subscribed. Additive: older app code keeps working.

create table push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  role          text not null check (role in ('entrepreneur', 'mentor')),
  -- The push service address for one browser on one device (unique per device).
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_sent_at  timestamptz
);

create index push_subscriptions_role_idx on push_subscriptions (role);

-- Server only (service role), like every other table.
alter table push_subscriptions enable row level security;

-- ===== 20261111000009_beginner_coach.sql =====
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
