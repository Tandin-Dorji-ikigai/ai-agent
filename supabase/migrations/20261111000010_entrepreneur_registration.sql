-- Real entrepreneur accounts coexist with fictional demo profiles.
begin;

alter table public.profiles
  add column auth_user_id uuid unique references auth.users(id) on delete cascade;
alter table public.entrepreneur_profiles
  add column onboarding_path text not null default 'idea'
    check (onboarding_path in ('idea', 'exploring')),
  add column onboarding_details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(onboarding_details) = 'object');

create function public.register_entrepreneur_from_auth()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  registration jsonb := new.raw_user_meta_data -> 'mentorflow_registration';
  assessment jsonb;
begin
  -- Other auth providers / future mentor registration may have separate flows.
  if registration is null then return new; end if;
  assessment := registration -> 'assessment';
  if jsonb_typeof(registration) <> 'object' or jsonb_typeof(assessment) <> 'object'
     or length(trim(coalesce(registration ->> 'full_name', ''))) not between 1 and 120
     or length(trim(coalesce(registration ->> 'location', ''))) not between 1 and 120
     or registration ->> 'path' not in ('idea', 'exploring')
     or (registration ->> 'path' = 'idea' and trim(coalesce(assessment ->> 'business_name', '')) = '')
     or (registration ->> 'path' = 'exploring' and assessment ->> 'business_stage' <> 'idea') then
    raise exception 'INVALID_ENTREPRENEUR_REGISTRATION';
  end if;

  -- The role and ownership come from this trigger, never from user metadata.
  insert into public.profiles(id, auth_user_id, role, full_name, phone, location, preferred_language)
  values (new.id, new.id, 'entrepreneur', trim(registration ->> 'full_name'),
    nullif(trim(registration ->> 'phone'), ''), trim(registration ->> 'location'),
    assessment ->> 'preferred_language');

  insert into public.entrepreneur_profiles(
    user_id, business_name, business_stage, sector, business_description,
    primary_challenge, goals, expertise_needs, languages, budget,
    assessment_completed_at, onboarding_path, onboarding_details
  ) values (
    new.id, assessment ->> 'business_name', assessment ->> 'business_stage',
    assessment ->> 'sector', assessment ->> 'business_description',
    assessment ->> 'primary_challenge',
    array(select jsonb_array_elements_text(assessment -> 'goals')),
    array(select jsonb_array_elements_text(assessment -> 'expertise_needs')),
    array(select jsonb_array_elements_text(assessment -> 'languages')),
    (assessment ->> 'budget')::numeric, now(), registration ->> 'path',
    coalesce(registration -> 'details', '{}'::jsonb)
  );
  return new;
end;
$$;
create trigger mentorflow_entrepreneur_signup
  after insert on auth.users for each row
  execute function public.register_entrepreneur_from_auth();
revoke all on function public.register_entrepreneur_from_auth() from public, anon, authenticated;

-- Preflight signup before Auth creates anything if this migration is missing.
create function public.entrepreneur_registration_ready()
returns boolean language sql stable security definer set search_path = ''
as $$ select true; $$;
revoke all on function public.entrepreneur_registration_ready() from public, anon, authenticated;
grant execute on function public.entrepreneur_registration_ready() to service_role;

-- The old reset deletes every profile. Refuse it once real accounts exist,
-- including calls made directly through RPC. A future demo reset can be scoped
-- to fixture IDs, but it must never delete registered people.
alter function public.reset_demo(jsonb) rename to reset_demo_without_accounts;
revoke all on function public.reset_demo_without_accounts(jsonb) from public, anon, authenticated, service_role;
create function public.reset_demo(p_seed jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  -- Serialize with profile inserts so a simultaneous signup cannot be erased.
  lock table public.profiles in share row exclusive mode;
  if exists(select 1 from public.profiles where auth_user_id is not null) then
    raise exception 'REGISTERED_ACCOUNTS_EXIST';
  end if;
  return public.reset_demo_without_accounts(p_seed);
end;
$$;
revoke all on function public.reset_demo(jsonb) from public, anon, authenticated;
grant execute on function public.reset_demo(jsonb) to service_role;

-- Existing RLS denies direct anon/authenticated table access. Account reads use
-- validated Auth identity and server-side ownership filters; keep it that way.
commit;
