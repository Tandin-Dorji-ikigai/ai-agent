-- Handover contract between the call / audio-to-text work and the agent:
-- where a session's text came from, and the full call transcript if any.
-- Additive: existing rows default to 'typed'; older app code keeps working.

alter table sessions
  add column notes_source text not null default 'typed'
    check (notes_source in ('typed', 'voice_note', 'call_recording')),
  add column transcript text;
