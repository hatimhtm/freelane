-- Freelane: 3-kind tag taxonomy on finance.spend_categories.
--
-- Tag system locks at three kinds:
--   audience  — All / Business / Personal / For us. PINNED + IMMUTABLE.
--               Mutually exclusive at filter time; drives the prominent
--               radio row in Spending and gates business/personal/forUs
--               on every spend.
--   category  — predefined "what kind of spend" labels (Food, Transport,
--               Bills, Entertainment, Health, Groceries, Eating Out,
--               Cigarettes, Pet, Gifts, Tech, Clothing, Other). User
--               can archive defaults; cannot delete the seed rows.
--   custom    — user-created labels. created_by_user=true. Fully
--               deletable/archivable.
--
-- Why on spend_categories (not a new `tags` table): the existing m2m
-- table finance.spend_category_links already targets category_id, and
-- every reader in src/lib/spends.ts + src/components/spending/* keys
-- off spend_categories. Migrating to a separate `tags` table would
-- require renaming every column reference across ~2k lines of TS. The
-- design memo named "tags" as the conceptual layer; the SQL keeps
-- spend_categories as the storage layer with `tag_kind` discriminating.
--
-- Naming: column is `tag_kind` (NOT `kind`) — the pre-existing `kind`
-- column from migration 0030 already discriminates the Investment vs
-- Consumption Ledger (enum finance.spend_category_kind: consumption/
-- investment/neutral). The new column is a TEXT discriminator for the
-- audience/category/custom UI taxonomy. The two coexist.

alter table finance.spend_categories
  add column if not exists tag_kind text
    not null default 'category'
    check (tag_kind in ('audience', 'category', 'custom'));

alter table finance.spend_categories
  add column if not exists pinned boolean not null default false;

alter table finance.spend_categories
  add column if not exists created_by_user boolean not null default false;

comment on column finance.spend_categories.tag_kind is
  'Tag taxonomy. audience=All/Business/Personal/For us (pinned+immutable, mutually exclusive at filter time). category=predefined kinds. custom=user-created label.';
comment on column finance.spend_categories.pinned is
  'Immutable seed row — UI must reject delete/update of name/kind. Currently true only for the 4 audience seeds per user.';
comment on column finance.spend_categories.created_by_user is
  'True when the user explicitly added this tag via +New tag. False for seeds + backfilled defaults.';

-- Seed the 4 audience rows per existing user. spend_categories has a
-- unique(user_id, name) constraint (migration 0020), so re-runs and
-- pre-existing user rows named "Business"/"Personal" collide. Strategy:
--   1. INSERT with ON CONFLICT (user_id, name) DO NOTHING so re-running
--      the migration is idempotent.
--   2. After the insert, PROMOTE any pre-existing rows matching the four
--      canonical names (case-insensitive) to tag_kind='audience' +
--      pinned=true so legacy taxonomies still drive the audience filter.
--      Without this step, users with a "Business" tag from migration
--      0020 would see the audience radio render but no spends would
--      match any audience tag id (because tag_kind would still be
--      'category' on their legacy row).
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
      (u.user_id, 'All',      'audience', true, false, -40, false),
      (u.user_id, 'Business', 'audience', true, false, -30, false),
      (u.user_id, 'Personal', 'audience', true, false, -20, false),
      (u.user_id, 'For us',   'audience', true, false, -10, false)
    on conflict (user_id, name) do nothing;
  end loop;
end$$;

-- Promote any pre-existing rows with canonical audience names to
-- audience + pinned. Case-insensitive match covers "business" / "BUSINESS"
-- variants. This must run AFTER the insert so the conflict rows (which
-- kept their old tag_kind='category' default) get properly classified.
update finance.spend_categories
  set tag_kind = 'audience',
      pinned = true
where lower(trim(name)) in ('all', 'business', 'personal', 'for us')
  and tag_kind <> 'audience';

-- Backfill: any row created BEFORE the migration without an explicit
-- tag_kind defaulted to 'category' (the column default). User-created
-- tags can't be retroactively distinguished from seeds, so we leave
-- tag_kind on the default for legacy rows. Future inserts via the
-- createCustomTag action set tag_kind='custom' + created_by_user=true.

-- Recurring 5/hour notification cap query (per dispatcher contract) does
-- a window scan on (user_id, kind, created_at). Add the supporting index
-- so cap checks don't trigger a sequential scan on a hot path.
create index if not exists notifications_inbox_user_kind_created_idx
  on finance.notifications_inbox (user_id, kind, created_at desc);
