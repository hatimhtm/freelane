-- Freelane: canonical read-model table for every cached AI brain.
--
-- Generalises the single-brain shape from ai_focus_cache + ai_safe_spend_cache
-- + calm_weather_state into one table keyed by (user_id, brain_key). All new
-- brain caching writes here; the old single-brain tables stay for backward
-- compatibility reads during the transition.
--
-- Regeneration triggers (see src/lib/ai/cache.ts):
--   1. on-read TTL expiry  (per-brain ttlMs; default 24h)
--   2. explicit invalidateBrainCache(brainKey) from mutating server actions
--   3. input fingerprint mismatch (hash of last N spend/payment/withdrawal ids)
--   4. manual refresh button
--
-- input_fingerprint is a short hash the brain computes from its inputs; on
-- read the wrapper compares against the current fingerprint and regens if
-- they differ. Cheap correctness backstop for missed invalidations.

create table if not exists finance.ai_brain_cache (
  user_id           uuid not null references auth.users(id) on delete cascade,
  brain_key         text not null,
  payload           jsonb not null,
  generated_at      timestamptz not null default now(),
  stale_at          timestamptz,
  input_fingerprint text,
  primary key (user_id, brain_key)
);

create index if not exists ai_brain_cache_gen_idx
  on finance.ai_brain_cache (user_id, generated_at desc);

alter table finance.ai_brain_cache enable row level security;

create policy "owner_all" on finance.ai_brain_cache
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on column finance.ai_brain_cache.brain_key is
  'e.g. safe_to_spend_ai, calm_weather, daily_focus, forecast_story, pack_rhythm, late_night, sleep_echo, sadaka_rhythm, post_payday, eid_prep, tuesday_checkin, year_recall, income_strip';

comment on table finance.ai_brain_cache is
  'One row per (user, brain). Readers fetch this; regen is async via TTL, explicit invalidation, fingerprint mismatch, or manual refresh.';
