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
