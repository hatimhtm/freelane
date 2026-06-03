-- Freelane: per-entity pattern baselines (Entities workflow — pattern detection).
--
-- Mirrors finance.client_pattern_baselines (migration 0077). The
-- entity-pattern-change brain (Pro, EWMA + stddev z-score) needs a "what's
-- normal for this entity" cache to compare each new event against.
-- Re-aggregating transfers + sadaka_payments + beneficiary_spends on every
-- event would be cheap once but pricey across multi-month windows.
--
-- min_baseline=5 (the freelane-entities-design brief lowered the floor
-- from Clients' 14; entity activity is lower frequency). The brain's math
-- gate still enforces |z| ≥ 2 + dominant ≥ 60% so a small noisy sample
-- doesn't trip false positives.
--
-- typical_interaction_kinds tracks the histogram of interaction types
-- (transfer, sadaka_payment, gift, loan_repayment, family_support,
-- beneficiary_spend) for the interaction_kind_switch pattern.

create table if not exists finance.entity_pattern_baselines (
  entity_id                   uuid primary key references finance.entities(id) on delete cascade,
  user_id                     uuid not null references auth.users(id) on delete cascade,
  transfer_cadence_mean       numeric,
  transfer_cadence_stddev     numeric,
  transfer_amount_mean        numeric,
  transfer_amount_stddev      numeric,
  typical_interaction_kinds   jsonb not null default '[]'::jsonb,
  events_count                int  not null default 0,
  updated_at                  timestamptz not null default now()
);

create index if not exists entity_pattern_baselines_user_entity_idx
  on finance.entity_pattern_baselines (user_id, entity_id);

alter table finance.entity_pattern_baselines enable row level security;

create policy "entity_pattern_baselines_owner_all"
  on finance.entity_pattern_baselines
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- updated_at trigger — mirrors client_pattern_baselines (migration 0077).
create or replace function finance.touch_entity_pattern_baselines() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists entity_pattern_baselines_touch
  on finance.entity_pattern_baselines;
create trigger entity_pattern_baselines_touch
  before update on finance.entity_pattern_baselines
  for each row execute function finance.touch_entity_pattern_baselines();

comment on table finance.entity_pattern_baselines is
  'Per-entity cached aggregates (transfer cadence + amount EWMA/stddev, interaction-kind histogram) for the entity-pattern-change brain. Refreshed lazily after each qualifying event.';
comment on column finance.entity_pattern_baselines.typical_interaction_kinds is
  'JSON array [{kind, count}] sorted desc. Used by the interaction_kind_switch pattern detection — a new event whose kind is < 60% of the dominant kind triggers a switch notification.';
comment on column finance.entity_pattern_baselines.events_count is
  'Total events folded into the baselines. The math gate in entity-pattern-change requires events_count ≥ 5 (min_baseline) before any pattern fires.';

-- ── Per-user backfill cursor for the canonicalize-entity sweep ──
--
-- The entity_backfill_progress table mirrors finance.vendor_backfill_progress
-- (migration 0093). One row per user; the cron route advances the cursor
-- batch-by-batch until finished_at is set. Lives in this migration (with
-- pattern_baselines) because both tables support the same Entities
-- workflow sub-system; keeping them together keeps the migration count
-- tight without breaking the "0096+ only" boundary the brief locked.

create table if not exists finance.entity_backfill_progress (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  cursor_entity_id     uuid,
  entities_processed   int  not null default 0,
  entities_total       int,
  finished_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table finance.entity_backfill_progress enable row level security;

create policy "entity_backfill_progress_owner_all"
  on finance.entity_backfill_progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists entity_backfill_progress_touch
  on finance.entity_backfill_progress;
create trigger entity_backfill_progress_touch
  before update on finance.entity_backfill_progress
  for each row execute function finance.touch_entity_pattern_baselines();

comment on table finance.entity_backfill_progress is
  'Per-user cursor for the canonicalize-entity backfill sweep. One row per user; advanced batch-by-batch by /api/cron/entities-backfill.';
