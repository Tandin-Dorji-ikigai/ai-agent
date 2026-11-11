-- Needs assessment extras: the form always asked these, but they were not
-- saved. Optional; the mentor sees them on the request and the agent uses
-- them in the summary and the session briefs. Additive: older code keeps working.
alter table entrepreneur_profiles add column progress_so_far text;
alter table entrepreneur_profiles add column vision text;
alter table entrepreneur_profiles add column timeframe text check (timeframe in ('1 month', '3 months', '6 months', '12 months', 'Flexible'));
alter table entrepreneur_profiles add column mentoring_format text check (mentoring_format in ('either', 'online', 'in_person'));
