-- Freelane: vendor_price_history correctness fixes on top of 0091.
--
-- 0091 SEALED — this migration applies the verifier-flagged corrections:
--   1. quantity DOUBLE-COUNTING + WRONG-UNIT bug. The original trigger
--      hardcoded `quantity = 1` instead of reading spend_items.quantity,
--      so multi-quantity items (e.g. "3 × eggs ₱180") landed with
--      unit_amount = 180 instead of 60. The schema's whole point —
--      `unit_amount = amount / quantity` — was dead weight.
--   2. DOUBLE-COUNTING between the link trigger + item trigger inside
--      the same transaction. createSpend inserts spend_vendor_links
--      BEFORE spend_items, so the link trigger sees zero items and
--      writes a whole-visit observation; the item triggers then add
--      per-item rows for the same money. We now gate the link trigger
--      on the CONSTRAINT-deferred final-state of spend_items, by using
--      pg_trigger_depth + a deferred constraint trigger.
--   3. Triggers were INSERT-only. UPDATE/DELETE on spend_items and
--      spend_vendor_links never mirrored into vendor_price_history, so
--      typo-fixes + re-tags silently drifted the price history. Add
--      AFTER UPDATE / DELETE handlers that rewrite the matching
--      source_spend_item_id row.
--
-- Also: widen vendor_price_history.quantity to numeric(10,3) so the
-- spend_items.quantity column type (migration 0048) flows through
-- unchanged instead of rounding-on-insert.

-- Step 1 — widen quantity column. Numeric is back-compat with the
-- existing integer rows (Postgres auto-casts on read).
--
-- ─── ORDER MATTERS ──────────────────────────────────────────────────
-- 0091 defined unit_amount as a STORED generated column over quantity:
--   unit_amount numeric generated always as (amount / nullif(quantity, 0)) stored
-- Postgres refuses to ALTER the type of a column that a generated
-- column reads from:
--   ERROR: 0A000: cannot alter type of a column used by a generated column
-- Fix: drop the generated column, widen quantity, recreate the
-- generated column. The recreated column re-computes for every row.
alter table finance.vendor_price_history
  drop column if exists unit_amount;

alter table finance.vendor_price_history
  alter column quantity type numeric(10,3) using quantity::numeric(10,3);

alter table finance.vendor_price_history
  add column unit_amount numeric generated always as (amount / nullif(quantity, 0)) stored;

-- Step 2 — rebuild the per-item trigger to propagate the real quantity.
create or replace function finance.vendor_price_history_on_item_insert()
returns trigger
language plpgsql
security definer
set search_path = finance, public
as $$
declare
  v_spend  finance.spends%rowtype;
begin
  select * into v_spend from finance.spends where id = new.spend_id;
  if not found then
    return new;
  end if;
  insert into finance.vendor_price_history (
    user_id, vendor_id, item_label, amount, quantity, observed_at,
    source_spend_id, source_spend_item_id
  )
  select
    v_spend.user_id,
    svl.vendor_id,
    new.name,
    coalesce(new.amount, 0),
    -- 0091 hardcoded `1` here, ignoring spend_items.quantity entirely.
    -- That collapsed every multi-quantity item into a whole-line
    -- unit_amount. Propagate the real value, defaulting to 1 only for
    -- legacy rows that never set it.
    coalesce(new.quantity, 1)::numeric(10,3),
    v_spend.spent_at::date,
    v_spend.id,
    new.id
  from finance.spend_vendor_links svl
  where svl.spend_id = v_spend.id
    and coalesce(new.amount, 0) > 0;
  return new;
end;
$$;

-- Step 3 — rebuild the link trigger so it NEVER double-counts. The
-- createSpend transaction inserts the link before items; running this
-- statement-level at end of transaction is what we want, but Postgres
-- AFTER INSERT triggers can be marked CONSTRAINT trigger DEFERRABLE
-- INITIALLY DEFERRED to fire at commit time — by which point the items
-- have landed and the count(*) check is accurate.
create or replace function finance.vendor_price_history_on_link_insert()
returns trigger
language plpgsql
security definer
set search_path = finance, public
as $$
declare
  v_spend  finance.spends%rowtype;
  v_items  integer;
begin
  select * into v_spend from finance.spends where id = new.spend_id;
  if not found then
    return new;
  end if;
  -- Deferred fire — items will already be present if this spend has any.
  select count(*) into v_items from finance.spend_items where spend_id = new.spend_id;
  if v_items > 0 then
    -- Items already wrote per-item observations; whole-visit row would
    -- double-count the same money.
    return new;
  end if;
  if coalesce(v_spend.amount_base, 0) <= 0 then
    return new;
  end if;
  -- Idempotency belt: if a whole-visit row for this (spend, vendor)
  -- already exists (manual replay, vendor link re-insert), skip.
  if exists (
    select 1 from finance.vendor_price_history
    where source_spend_id = v_spend.id
      and vendor_id = new.vendor_id
      and source_spend_item_id is null
  ) then
    return new;
  end if;
  insert into finance.vendor_price_history (
    user_id, vendor_id, item_label, amount, quantity, observed_at,
    source_spend_id, source_spend_item_id
  )
  values (
    v_spend.user_id,
    new.vendor_id,
    null,
    coalesce(v_spend.amount_base, 0),
    1,
    v_spend.spent_at::date,
    v_spend.id,
    null
  );
  return new;
end;
$$;

drop trigger if exists vendor_price_history_link_after_insert on finance.spend_vendor_links;
-- DEFERRABLE constraint trigger fires at COMMIT, after the same-txn
-- spend_items inserts have landed. Constraint triggers must be AFTER
-- INSERT and FOR EACH ROW.
create constraint trigger vendor_price_history_link_after_insert
  after insert on finance.spend_vendor_links
  deferrable initially deferred
  for each row execute function finance.vendor_price_history_on_link_insert();

-- Step 4 — AFTER UPDATE on spend_items mirrors edits onto the existing
-- observation row. A user fixing a typo on amount/quantity/name keeps
-- the price-history time series honest.
create or replace function finance.vendor_price_history_on_item_update()
returns trigger
language plpgsql
security definer
set search_path = finance, public
as $$
begin
  if new.amount is distinct from old.amount
     or new.quantity is distinct from old.quantity
     or new.name is distinct from old.name then
    update finance.vendor_price_history
       set amount = coalesce(new.amount, 0),
           quantity = coalesce(new.quantity, 1)::numeric(10,3),
           item_label = new.name
     where source_spend_item_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists vendor_price_history_item_after_update on finance.spend_items;
create trigger vendor_price_history_item_after_update
after update on finance.spend_items
for each row execute function finance.vendor_price_history_on_item_update();

-- Step 5 — AFTER DELETE on spend_items removes orphaned observations.
-- ON DELETE SET NULL on source_spend_item_id (0091) keeps the row
-- around but with a dangling source ref; for the brain's purposes the
-- observation should disappear with the source.
create or replace function finance.vendor_price_history_on_item_delete()
returns trigger
language plpgsql
security definer
set search_path = finance, public
as $$
begin
  delete from finance.vendor_price_history
   where source_spend_item_id = old.id;
  return old;
end;
$$;

drop trigger if exists vendor_price_history_item_after_delete on finance.spend_items;
create trigger vendor_price_history_item_after_delete
after delete on finance.spend_items
for each row execute function finance.vendor_price_history_on_item_delete();

-- Step 6 — AFTER DELETE on spend_vendor_links removes the matching
-- observation rows for this (spend_id, vendor_id) pair. Re-tag-from-
-- one-vendor-to-another scenarios are common ("I logged it under SM but
-- it was actually Mercury") and leaving stale rows pinned to the old
-- vendor poisons the trend signal forever.
create or replace function finance.vendor_price_history_on_link_delete()
returns trigger
language plpgsql
security definer
set search_path = finance, public
as $$
begin
  delete from finance.vendor_price_history
   where source_spend_id = old.spend_id
     and vendor_id = old.vendor_id;
  return old;
end;
$$;

drop trigger if exists vendor_price_history_link_after_delete on finance.spend_vendor_links;
create trigger vendor_price_history_link_after_delete
after delete on finance.spend_vendor_links
for each row execute function finance.vendor_price_history_on_link_delete();

-- Step 7 — rewrite the misleading comment on 0091's link trigger
-- description. The previous block described an UPDATE-based design that
-- was never implemented. Replace with what we actually do (AFTER INSERT
-- CONSTRAINT trigger fired at commit time).
comment on function finance.vendor_price_history_on_link_insert() is
  'Fires DEFERRED at txn commit on spend_vendor_links INSERT. When the linked spend has no spend_items, appends a whole-visit observation; when items exist, returns silently so the per-item trigger owns the observations.';

comment on function finance.vendor_price_history_on_item_insert() is
  'Fires per spend_items INSERT. Joins the parent spend''s vendor links and writes one observation per (item, vendor). Propagates spend_items.quantity into vendor_price_history.quantity so unit_amount = amount / quantity reflects the real per-unit price.';

comment on function finance.vendor_price_history_on_item_update() is
  'Keeps vendor_price_history in lockstep with edits to amount/quantity/name on the source spend_item — fixes typo-class drift in the price-history time series.';

comment on function finance.vendor_price_history_on_item_delete() is
  'Removes the observation row for a deleted spend_item so the brain never reads from a deleted source. Mirrors ON DELETE behavior for spend_vendor_links.';

comment on function finance.vendor_price_history_on_link_delete() is
  'Removes observations for a deleted (spend, vendor) link so re-tagging from one vendor to another does not leave stale rows pinned to the wrong vendor.';
