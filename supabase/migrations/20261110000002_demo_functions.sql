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
