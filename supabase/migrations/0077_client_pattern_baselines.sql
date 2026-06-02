-- Freelane: per-client pattern baseline cache.
--
-- Why this exists: the client_pattern_change brain (clients workflow) needs
-- a "what's normal for this client" view to compare each new payment + project
-- against. Re-aggregating payments → projects → wallets on every event is
-- cheap once but pricey at scale and across multi-month windows. This table
-- caches the aggregates per client so the brain reads a single row instead of
-- a join-heavy query on every event.
--
-- Refreshed by client-pattern-actions.ts:refreshClientPatternBaselines on
-- every new payment landing / project status change event (cheap upsert).
--
-- Schema:
--   client_id                   PK + FK clients(id) on delete cascade.
--   user_id                     FK auth.users(id) — RLS owner scope.
--   typical_payment_wallets     jsonb array [{wallet_id, count}] sorted desc.
--   typical_project_amount_mean numeric, native currency rolling mean.
--   typical_project_amount_stddev numeric, sample stddev for z-score gating.
--   typical_project_count       int, count of completed projects fed into mean.
--   updated_at                  timestamptz, touched on every upsert.
--
-- Also adds finance.ai_user_facts.archived_at so the Clients workflow's
-- "delete fact" UI can soft-archive a row without losing the audit trail
-- (the extraction brain reads currently-live facts via archived_at is null).

create table if not exists finance.client_pattern_baselines (
  client_id                       uuid primary key references finance.clients(id) on delete cascade,
  user_id                         uuid not null references auth.users(id) on delete cascade,
  typical_payment_wallets         jsonb,
  typical_project_amount_mean     numeric,
  typical_project_amount_stddev   numeric,
  typical_project_count           int,
  updated_at                      timestamptz not null default now()
);

create index if not exists client_pattern_baselines_user_client_idx
  on finance.client_pattern_baselines (user_id, client_id);

alter table finance.client_pattern_baselines enable row level security;

create policy "client_pattern_baselines_owner_all" on finance.client_pattern_baselines
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Updated_at trigger — matches the convention from ai_user_facts (migration
-- 0062). Inline create-or-replace keeps the migration self-contained.
create or replace function finance.touch_client_pattern_baselines() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists client_pattern_baselines_touch on finance.client_pattern_baselines;
create trigger client_pattern_baselines_touch
  before update on finance.client_pattern_baselines
  for each row execute function finance.touch_client_pattern_baselines();

comment on table finance.client_pattern_baselines is
  'Per-client cached aggregates (typical wallet, typical project mean/stddev) for the client_pattern_change brain. Refreshed lazily on payment/project events.';

-- ai_user_facts.archived_at — soft-archive column for the Clients workflow's
-- fact-deletion UI. The brain readers and facts-panel filter on
-- "archived_at is null" so an archived fact disappears from the AI view
-- (and the per-fact UI) without removing the row. Idempotent ADD COLUMN.
alter table finance.ai_user_facts
  add column if not exists archived_at timestamptz;

comment on column finance.ai_user_facts.archived_at is
  'Soft-archive timestamp. NULL = live fact. Set by the Clients facts panel deleteFact action; live readers filter where archived_at is null.';
