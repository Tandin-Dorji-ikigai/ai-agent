-- Calls switch from Daily to LiveKit (Daily needs a card on file before anyone
-- can join; LiveKit Cloud's free plan does not). 'daily' stays allowed so any
-- existing rows remain valid. Additive: older app code keeps working.

alter table calls drop constraint calls_provider_check;
alter table calls add constraint calls_provider_check check (provider in ('livekit', 'daily', 'none'));
