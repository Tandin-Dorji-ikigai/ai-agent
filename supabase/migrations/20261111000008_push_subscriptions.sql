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
