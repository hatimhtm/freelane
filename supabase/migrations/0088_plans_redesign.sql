-- Freelane: Plans tab facelift. Tier 1 introduced planned_spends with a
-- "lock the money" mechanism (status='committed' + committed_base +
-- committed_at). The Plans redesign drops that mechanism: the user can
-- edit anything anytime, and money no longer parks per plan. Instead the
-- workflow now revolves around:
--
--   - AI price lookup for the planned purchase (ai_price_range + sources)
--   - AI-proposed savings strategies (separate finance.plan_strategies
--     table — migration 0089)
--   - Decision support at purchase time (no schema change — uses the
--     fresh-each-invocation purchase-decision brain)
--   - Bought / abandoned archive with a 2-week satisfaction rating
--
-- This migration:
--   1. Collapses the planned_spend_status enum: drops 'committed',
--      keeps 'planned' (renamed to 'active' implicit alias via
--      status semantics), 'done' (renamed to 'bought'), adds
--      'abandoned' (separate from 'cancelled').
--      Postgres can't DROP a single enum VALUE — we rename the old
--      type, create the new type, ALTER the column with USING, then
--      drop the old type.
--   2. Drops committed_base + committed_at columns (no longer used).
--   3. Adds AI price lookup metadata, target_date, justification,
--      bought_at, bought_actual_price, satisfaction_rating.
--
-- The default_category_ids / wallet_id / planned_for_window_days /
-- certainty / is_big_plan columns stay for backward compatibility but
-- the new UI does not surface them. Existing seeded rows
-- (MacBook + Apple Dev from 0027) are preserved as status='active'.
--
-- ─── ORDER MATTERS ──────────────────────────────────────────────────
-- The partial indexes from 0027 (planned_spends_open_idx,
-- planned_spends_big_idx) reference the literal 'committed' in their
-- WHERE clauses. Once the type is renamed to _old and the new type
-- created, the ALTER COLUMN TYPE step tries to validate those indexes
-- against the new enum and fails with
--   "operator does not exist: planned_spend_status = planned_spend_status_old"
-- because 'committed' doesn't exist in the new vocabulary. Fix: drop
-- those indexes BEFORE renaming the type, then recreate after the swap.

-- ─── Step 0: stage existing 'committed' rows back to active ────────
-- Same logical state as 'planned' under the new model. Null out the
-- now-defunct columns before they're dropped in step 5.
update finance.planned_spends
   set committed_base = null,
       committed_at = null
 where status::text = 'committed';

-- ─── Step 0.5: drop the enum-literal-referencing indexes ────────────
-- Must happen BEFORE the type rename / column-type swap so the
-- ALTER COLUMN doesn't try to validate them.
drop index if exists finance.planned_spends_open_idx;
drop index if exists finance.planned_spends_big_idx;

-- ─── Step 1: rename old enum so the new one can take its name ──────
alter type finance.planned_spend_status rename to planned_spend_status_old;

-- ─── Step 2: create the new enum without 'committed' ───────────────
-- 'planned' renames to 'active' in the UI but we keep the wire value
-- for backward compat — the spendings-side filters key off this enum
-- and a rename would ripple through every reader. Add 'bought' (new
-- materialized state), keep 'done' for any historical row, add
-- 'abandoned' (distinct from user-cancelled).
create type finance.planned_spend_status as enum (
  'active', 'planned', 'bought', 'done', 'cancelled', 'abandoned'
);

-- ─── Step 3: alter the column to the new type ──────────────────────
-- Drop the default first so the type swap doesn't try to recast it.
-- Map rows previously 'committed' (already nulled above) to 'active'
-- since the new world has no lock; everything else passes through
-- text → new enum.
alter table finance.planned_spends
  alter column status drop default;

alter table finance.planned_spends
  alter column status type finance.planned_spend_status
  using (
    case status::text
      when 'committed' then 'active'::finance.planned_spend_status
      else status::text::finance.planned_spend_status
    end
  );

alter table finance.planned_spends
  alter column status set default 'planned'::finance.planned_spend_status;

-- ─── Step 4: drop the old enum type ────────────────────────────────
-- All columns and indexes that referenced it are off it now.
drop type finance.planned_spend_status_old;

-- ─── Step 5: recreate the indexes with the new vocabulary ──────────
create index if not exists planned_spends_open_idx
  on finance.planned_spends (user_id, planned_for)
  where status in ('planned', 'active');

create index if not exists planned_spends_big_idx
  on finance.planned_spends (user_id, planned_for)
  where is_big_plan = true and status in ('planned', 'active');

-- ─── Step 6: drop the lock-mechanism columns ───────────────────────
alter table finance.planned_spends
  drop column if exists committed_base,
  drop column if exists committed_at;

-- ─── Step 7: add new columns for the redesign ──────────────────────

-- price_source — where the current expected_base came from. Default
-- 'user' for existing rows (the seeded MacBook + Apple Dev rows are
-- user-entered). 'ai' = lookup brain wrote it. 'adjusted' = AI wrote it
-- then the user edited it.
alter table finance.planned_spends
  add column if not exists price_source text not null default 'user'
    check (price_source in ('user', 'ai', 'adjusted'));

-- AI price lookup metadata. range_low/high in base currency (PHP). The
-- sources column carries the sites the brain referenced
-- (Shopee, Carousell, Lazada, …). All nullable so manual rows skip the
-- AI step entirely.
alter table finance.planned_spends
  add column if not exists ai_price_range_low numeric(14, 2),
  add column if not exists ai_price_range_high numeric(14, 2),
  add column if not exists ai_price_sources jsonb,
  add column if not exists ai_price_at timestamptz;

-- target_date — optional "by when" the user wants this. Distinct from
-- planned_for, which is the spend date estimate. target_date drives the
-- "by Jul 2026" line on cards + the plan_target_approaching
-- notification (30d before).
alter table finance.planned_spends
  add column if not exists target_date date;

-- justification — freeform "why I want this". Shown in the detail
-- sheet only, never on the card. Optional. (notes already exists from
-- 0027 — kept separate so the AI can distinguish "why I want this"
-- from "implementation notes".)
alter table finance.planned_spends
  add column if not exists justification text;

-- Bought tracking — when the plan materialized + the actual price paid
-- (may differ from expected). status='bought' rows always have these.
alter table finance.planned_spends
  add column if not exists bought_at date,
  add column if not exists bought_actual_price numeric(14, 2);

-- Satisfaction rating — captured 14d after bought_at via the
-- plan_satisfaction_check notification. 1-5 stars + optional note (the
-- note is stored in the existing `notes` column).
alter table finance.planned_spends
  add column if not exists satisfaction_rating smallint
    check (satisfaction_rating is null or satisfaction_rating between 1 and 5);
