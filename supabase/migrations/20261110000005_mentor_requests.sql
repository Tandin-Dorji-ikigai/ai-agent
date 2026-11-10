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
