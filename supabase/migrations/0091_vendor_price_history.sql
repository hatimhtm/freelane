-- Freelane: per-(vendor, item) price observation time series.
--
-- The weekly price-check brain (api/cron/weekly-price-check) consults this
-- table for prior_4w_avg + delta_pct on noteworthy vendor+item shifts. It
-- is populated synchronously by triggers on finance.spends and
-- finance.spend_items so every spend logged contributes the moment it
-- lands (including historical rows backfilled below).
--
-- Granularity (locked 2026-06-02 freelane-vendors-design):
--   • If the spend has spend_items rows → one observation per item, the
--     item_label carrying the label string (e.g. "burger meal").
--   • If the spend has NO items → one observation with item_label=null
--     representing the whole-visit amount ("Jollibee · ₱180").
--
-- unit_amount is a generated column so callers never store a divide-by-
-- zero. quantity defaults to 1 so single-line items keep amount===unit.

create table if not exists finance.vendor_price_history (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  vendor_id            uuid not null references finance.vendors(id) on delete cascade,
  item_label           text,
  amount               numeric not null,
  quantity             integer not null default 1,
  unit_amount          numeric generated always as (amount / nullif(quantity, 0)) stored,
  observed_at          date not null,
  source_spend_id      uuid references finance.spends(id) on delete set null,
  source_spend_item_id uuid references finance.spend_items(id) on delete set null,
  created_at           timestamptz not null default now()
);

-- Vendor + item + recency: the weekly brain reads "last 30d of observations
-- for THIS vendor sorted desc, then group by item_label" — this index keeps
-- that single query index-only.
create index if not exists vendor_price_history_vendor_item_date_idx
  on finance.vendor_price_history (vendor_id, item_label, observed_at desc);

-- Owner-scope index for the user-loop in the cron route.
create index if not exists vendor_price_history_user_idx
  on finance.vendor_price_history (user_id, observed_at desc);

alter table finance.vendor_price_history enable row level security;

create policy vendor_price_history_owner_select on finance.vendor_price_history
  for select using (user_id = auth.uid());
create policy vendor_price_history_owner_insert on finance.vendor_price_history
  for insert with check (user_id = auth.uid());
create policy vendor_price_history_owner_update on finance.vendor_price_history
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy vendor_price_history_owner_delete on finance.vendor_price_history
  for delete using (user_id = auth.uid());

-- Trigger: per spend_item insert, append one observation joined to the
-- spend's linked vendor (via spend_vendor_links). When a spend touches
-- multiple vendors, the item is mirrored under each. Best-effort: the
-- INSERT … SELECT silently emits zero rows if the spend has no vendor
-- link (the brain only cares about vendor-resolved observations).
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
    1,
    v_spend.spent_at::date,
    v_spend.id,
    new.id
  from finance.spend_vendor_links svl
  where svl.spend_id = v_spend.id
    and coalesce(new.amount, 0) > 0;
  return new;
end;
$$;

drop trigger if exists vendor_price_history_item_after_insert on finance.spend_items;
create trigger vendor_price_history_item_after_insert
after insert on finance.spend_items
for each row execute function finance.vendor_price_history_on_item_insert();

-- Trigger: per spend insert that ends up with NO items attached, append a
-- whole-visit observation. The trigger fires on AFTER UPDATE OF spend's
-- vendor link instead (since vendor links land via a separate insert post-
-- spend). The simplest stable hook is the spend_vendor_links insert
-- itself: when a vendor is linked to a spend, write a whole-visit row IF
-- that spend has no spend_items. The item-level trigger above stays the
-- canonical path when items exist.
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
  select count(*) into v_items from finance.spend_items where spend_id = new.spend_id;
  if v_items > 0 then
    -- Items will fire their own observations; whole-visit row would be
    -- a duplicate signal for the same money.
    return new;
  end if;
  if coalesce(v_spend.amount_base, 0) <= 0 then
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
create trigger vendor_price_history_link_after_insert
after insert on finance.spend_vendor_links
for each row execute function finance.vendor_price_history_on_link_insert();

-- Backfill: one-shot insert for every PRE-EXISTING vendor-linked spend
-- so the weekly brain has a real time series the first time it runs.
-- The triggers above will keep it populated going forward.
insert into finance.vendor_price_history (
  user_id, vendor_id, item_label, amount, quantity, observed_at,
  source_spend_id, source_spend_item_id
)
select
  s.user_id,
  svl.vendor_id,
  si.name,
  coalesce(si.amount, 0),
  1,
  s.spent_at::date,
  s.id,
  si.id
from finance.spend_vendor_links svl
join finance.spends s on s.id = svl.spend_id
join finance.spend_items si on si.spend_id = s.id
where coalesce(si.amount, 0) > 0;

-- Whole-visit backfill for vendor-linked spends with no items.
insert into finance.vendor_price_history (
  user_id, vendor_id, item_label, amount, quantity, observed_at,
  source_spend_id, source_spend_item_id
)
select
  s.user_id,
  svl.vendor_id,
  null,
  coalesce(s.amount_base, 0),
  1,
  s.spent_at::date,
  s.id,
  null
from finance.spend_vendor_links svl
join finance.spends s on s.id = svl.spend_id
where not exists (select 1 from finance.spend_items si where si.spend_id = s.id)
  and coalesce(s.amount_base, 0) > 0;

comment on table finance.vendor_price_history is
  'Per-(vendor, item) price observation time series. Triggers on spend_items/spend_vendor_links keep this populated; weekly-price-check brain reads it for delta_pct + prior_4w_avg signals.';
