-- Session recap: what the session covered and what it achieved, written by the
-- agent from the call transcript (or the mentor's notes) when a session ends.
-- Both people see it in their session history, with the agreed actions and
-- the full transcript. Additive: older app code keeps working.
alter table sessions add column recap jsonb;
alter table sessions add column recap_source text check (recap_source in ('live_ai', 'fallback'));
