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
