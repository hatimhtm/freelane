-- Freelane: vendor_price_history idempotency belt + cohort discovery RPC.
--
-- 0091 SEALED — this migration adds two belts on top:
--   1. UNIQUE INDEX on (source_spend_item_id) WHERE NOT NULL — guards
--      against re-applying 0091's per-item backfill. The CONSTRAINT
--      trigger from 0094 already protects the live INSERT path; this
--      protects the schema-replay path (db reset → re-migrate after
--      manual fixes). Without this index, a re-apply of 0091 would
--      DOUBLE every per-item observation since 0094's per-item insert
--      handler has no idempotency clause of its own.
--   2. UNIQUE INDEX on (source_spend_id, vendor_id) WHERE
--      source_spend_item_id IS NULL — same belt for the whole-visit
--      rows. 0094's link trigger has an EXISTS guard for the live path
--      but the 0091 backfill block runs unconditionally on re-apply.
--   3. Cohort discovery RPC `recent_price_history_user_ids(since_ts
--      timestamptz)` returning DISTINCT user_ids. Replaces the
--      JS-side dedup over a row-bounded scan in the weekly-price-check
--      cron — works at any scale because the DISTINCT happens
--      server-side.

-- Step 1 — per-item idempotency belt. Partial unique so multi-NULL
-- (the whole-visit rows) is allowed.
create unique index if not exists vendor_price_history_unique_item_idx
  on finance.vendor_price_history (source_spend_item_id)
  where source_spend_item_id is not null;

-- Step 2 — whole-visit idempotency belt. Partial unique so per-item
-- rows are allowed even when their (source_spend_id, vendor_id) collides.
create unique index if not exists vendor_price_history_unique_visit_idx
  on finance.vendor_price_history (source_spend_id, vendor_id)
  where source_spend_item_id is null;

-- Step 3 — cohort discovery RPC. Server-side DISTINCT keeps the cron
-- scan O(distinct_users) instead of O(observations). SECURITY DEFINER
-- so the service-role client can call it without a per-row RLS check;
-- the function only emits user_id values that already match the
-- caller's input window so no information leak beyond "did this user
-- log a vendor observation in the last N days".
create or replace function finance.recent_price_history_user_ids(since_ts timestamptz)
returns table (user_id uuid)
language sql
security definer
set search_path = finance, public
as $$
  select distinct vph.user_id
  from finance.vendor_price_history vph
  where vph.observed_at >= since_ts::date
$$;

comment on function finance.recent_price_history_user_ids(timestamptz) is
  'Returns DISTINCT user_ids with vendor_price_history rows on/after since_ts. Drives the cohort scan in /api/cron/weekly-price-check so the cron doesn''t blow request memory on a multi-user instance.';

comment on index finance.vendor_price_history_unique_item_idx is
  'Idempotency belt — prevents 0091 per-item backfill from double-inserting on a re-apply (db reset + re-migrate). 0094''s live path is already idempotent via the DEFERRED constraint trigger.';

comment on index finance.vendor_price_history_unique_visit_idx is
  'Idempotency belt — prevents 0091 whole-visit backfill from double-inserting on a re-apply. Mirrors the EXISTS guard in 0094''s link-trigger for the live path.';
