-- Freelane: seed the brief-locked CATEGORY tag vocabulary.
--
-- Migration 0083 introduced the 3-kind tag taxonomy (audience / category
-- / custom) but only seeded the four AUDIENCE rows. The category seeds
-- the verifier expects (Food / Transport / Bills / Entertainment /
-- Health / Groceries / Eating Out / Cigarettes / Pet / Gifts / Tech /
-- Clothing / Other) were never inserted — users carried whatever vocab
-- migration 0020 had handed them (Fast food / Ordering food /
-- Transportation / Wifi / Bills, plus a long tail), and brand-new users
-- got that legacy mix too.
--
-- This migration:
--   1. Inserts the brief-locked category vocabulary per user, with
--      tag_kind='category' and pinned=false (categories are user-
--      archivable; only audience rows are immutable).
--   2. Aliases the legacy 0020 names to the new canonical ones so any
--      pre-existing spend_category_links keep resolving:
--        - "Transportation"     → "Transport"
--        - "Fast food"          → "Eating Out"
--        - "Ordering food"      → "Eating Out" (merged)
--        - "Wifi / Bills"       → "Bills"
--      The rename runs BEFORE the insert so the unique(user_id, name)
--      constraint accepts the new canonical names without conflict.
--      Rows whose canonical name already exists for that user collapse
--      via on conflict do nothing and the old row's links are
--      re-pointed in step 3.
--   3. Re-points spend_category_links from any duplicate legacy rows
--      (now shadowed by the canonical insert) to the canonical row,
--      then archives the legacy duplicates so they vanish from
--      category pickers but stay queryable for historical reports.
--   4. Installs a signup trigger that seeds the canonical category
--      vocabulary on every new auth.users insert (same pattern as
--      0086_audience_tags_signup_trigger). Otherwise users who sign up
--      after this migration would land in the "no categories" state
--      that 0083 + 0086 already proved was a footgun.
--
-- The brief locks vocabulary as the AUTHORITATIVE source — drift
-- (extra legacy names, missing canonical names) gets resolved here.

-- ─── Step 1: Rename legacy names to canonical where no conflict ──────
-- When the canonical name does NOT yet exist for that user, just
-- rename the legacy row in place. Avoids the on-conflict re-point step
-- whenever possible because rename preserves row id + history.

update finance.spend_categories sc
  set name = 'Transport'
where sc.name = 'Transportation'
  and not exists (
    select 1 from finance.spend_categories sc2
    where sc2.user_id = sc.user_id and sc2.name = 'Transport'
  );

update finance.spend_categories sc
  set name = 'Eating Out'
where sc.name = 'Fast food'
  and not exists (
    select 1 from finance.spend_categories sc2
    where sc2.user_id = sc.user_id and sc2.name = 'Eating Out'
  );

update finance.spend_categories sc
  set name = 'Bills'
where sc.name = 'Wifi / Bills'
  and not exists (
    select 1 from finance.spend_categories sc2
    where sc2.user_id = sc.user_id and sc2.name = 'Bills'
  );

-- ─── Step 2: Insert the canonical category vocabulary per user ───────
-- pinned=false (user can archive defaults; only audience rows are
-- pinned+immutable). tag_kind='category' explicit so future readers
-- don't depend on the column default.
do $$
declare
  u record;
begin
  for u in
    select id as user_id from auth.users
  loop
    insert into finance.spend_categories
      (user_id, name, tag_kind, pinned, created_by_user, sort_order, archived)
    values
      (u.user_id, 'Food',          'category', false, false, 10,  false),
      (u.user_id, 'Transport',     'category', false, false, 20,  false),
      (u.user_id, 'Bills',         'category', false, false, 30,  false),
      (u.user_id, 'Entertainment', 'category', false, false, 40,  false),
      (u.user_id, 'Health',        'category', false, false, 50,  false),
      (u.user_id, 'Groceries',     'category', false, false, 60,  false),
      (u.user_id, 'Eating Out',    'category', false, false, 70,  false),
      (u.user_id, 'Cigarettes',    'category', false, false, 80,  false),
      (u.user_id, 'Pet',           'category', false, false, 90,  false),
      (u.user_id, 'Gifts',         'category', false, false, 100, false),
      (u.user_id, 'Tech',          'category', false, false, 110, false),
      (u.user_id, 'Clothing',      'category', false, false, 120, false),
      (u.user_id, 'Other',         'category', false, false, 130, false)
    on conflict (user_id, name) do nothing;
  end loop;
end$$;

-- Promote any existing rows with canonical category names to
-- tag_kind='category' in case a user had created one as 'custom' or it
-- defaulted to category but missed the post-insert classification.
update finance.spend_categories
  set tag_kind = 'category'
where name in (
    'Food', 'Transport', 'Bills', 'Entertainment', 'Health',
    'Groceries', 'Eating Out', 'Cigarettes', 'Pet', 'Gifts',
    'Tech', 'Clothing', 'Other'
  )
  and tag_kind <> 'category'
  and tag_kind <> 'audience';

-- ─── Step 3: Re-point + archive legacy duplicates ────────────────────
-- Any row whose name is a legacy alias AND whose canonical sibling
-- already exists for the same user gets its spend_category_links
-- re-pointed to the canonical id, then archived. We don't delete the
-- row because deleting would orphan historical analytics that join on
-- the legacy id; archiving hides it from pickers while preserving
-- referential integrity.

with legacy_pairs as (
  select legacy.id   as legacy_id,
         canonical.id as canonical_id
  from finance.spend_categories legacy
  join finance.spend_categories canonical
    on canonical.user_id = legacy.user_id
   and (
        (legacy.name = 'Transportation' and canonical.name = 'Transport')
     or (legacy.name = 'Fast food'       and canonical.name = 'Eating Out')
     or (legacy.name = 'Ordering food'   and canonical.name = 'Eating Out')
     or (legacy.name = 'Wifi / Bills'    and canonical.name = 'Bills')
   )
)
update finance.spend_category_links scl
  set category_id = lp.canonical_id
from legacy_pairs lp
where scl.category_id = lp.legacy_id
  -- Skip if the same spend is ALREADY linked to the canonical id
  -- (composite PK would reject the double-insert). The duplicate
  -- legacy link just gets archived in the next statement.
  and not exists (
    select 1 from finance.spend_category_links scl2
    where scl2.spend_id = scl.spend_id
      and scl2.category_id = lp.canonical_id
  );

-- Delete leftover legacy-id links whose spend was already linked to the
-- canonical row (handled above via the not-exists guard). Without this
-- they'd dangle pointing at the soon-to-be-archived legacy row.
delete from finance.spend_category_links
where category_id in (
  select legacy.id
  from finance.spend_categories legacy
  join finance.spend_categories canonical
    on canonical.user_id = legacy.user_id
   and (
        (legacy.name = 'Transportation' and canonical.name = 'Transport')
     or (legacy.name = 'Fast food'       and canonical.name = 'Eating Out')
     or (legacy.name = 'Ordering food'   and canonical.name = 'Eating Out')
     or (legacy.name = 'Wifi / Bills'    and canonical.name = 'Bills')
   )
);

update finance.spend_categories sc
  set archived = true
where sc.name in ('Transportation', 'Fast food', 'Ordering food', 'Wifi / Bills')
  and exists (
    select 1 from finance.spend_categories canonical
    where canonical.user_id = sc.user_id
      and (
           (sc.name = 'Transportation' and canonical.name = 'Transport')
        or (sc.name = 'Fast food'       and canonical.name = 'Eating Out')
        or (sc.name = 'Ordering food'   and canonical.name = 'Eating Out')
        or (sc.name = 'Wifi / Bills'    and canonical.name = 'Bills')
      )
  );

-- ─── Step 4: Signup trigger so new users get the canonical vocab ────
-- Mirrors finance.audience_tags_seed_for_user from migration 0086.
-- Runs AFTER audience seeding so audience rows land first (lower
-- sort_order) and category rows append after in pickers.

create or replace function finance.category_tags_seed_for_user()
returns trigger
language plpgsql
security definer
set search_path = public, finance
as $$
begin
  insert into finance.spend_categories
    (user_id, name, tag_kind, pinned, created_by_user, sort_order, archived)
  values
    (new.id, 'Food',          'category', false, false, 10,  false),
    (new.id, 'Transport',     'category', false, false, 20,  false),
    (new.id, 'Bills',         'category', false, false, 30,  false),
    (new.id, 'Entertainment', 'category', false, false, 40,  false),
    (new.id, 'Health',        'category', false, false, 50,  false),
    (new.id, 'Groceries',     'category', false, false, 60,  false),
    (new.id, 'Eating Out',    'category', false, false, 70,  false),
    (new.id, 'Cigarettes',    'category', false, false, 80,  false),
    (new.id, 'Pet',           'category', false, false, 90,  false),
    (new.id, 'Gifts',         'category', false, false, 100, false),
    (new.id, 'Tech',          'category', false, false, 110, false),
    (new.id, 'Clothing',      'category', false, false, 120, false),
    (new.id, 'Other',         'category', false, false, 130, false)
  on conflict (user_id, name) do nothing;
  return new;
end;
$$;

drop trigger if exists category_tags_seed_trg on auth.users;
create trigger category_tags_seed_trg
  after insert on auth.users
  for each row
  execute function finance.category_tags_seed_for_user();
