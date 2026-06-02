-- Freelane: Sadaka auto-rules + entities.sadaka_recipient flag.
--
-- The auto-detection engine has 4 mechanisms; this table powers 1 + 3 + 4:
--
--   1. Cat & pet purchases — pattern match via match_kind=vendor_pattern or
--      match_kind=category (seed: 'pets' category + 3 cat-related vendor
--      patterns per user).
--   3. Transfers to specific people — entities.sadaka_recipient boolean. A
--      spend resolving to a flagged entity triggers an auto_detected row.
--   4. AI classifier — note_pattern denylist rows let the classifier learn
--      from "Not sadaka" rejections without losing the pattern signal.
--
-- match_kind:
--   vendor_pattern  → token-match against vendor name on the spend
--   category        → exact category-id match (we store the category name)
--   note_pattern    → token-match against the spend note
--   denylist_note   → SUPPRESSES classifier auto_detected when this pattern
--                     appears in a future spend note (the "Not sadaka"
--                     reject affordance writes one of these).

create table if not exists finance.sadaka_auto_rules (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  match_kind  text not null check (match_kind in (
    'vendor_pattern',
    'category',
    'note_pattern',
    'denylist_note'
  )),
  pattern     text not null,
  active      boolean not null default true,
  label       text,
  created_at  timestamptz not null default now()
);

create index if not exists sadaka_auto_rules_user_kind_idx
  on finance.sadaka_auto_rules (user_id, match_kind, active);

alter table finance.sadaka_auto_rules enable row level security;

create policy "sadaka_auto_rules_owner"
  on finance.sadaka_auto_rules
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Per-user seed: one category rule for pets + 3 vendor-pattern rules. The
-- app-side matcher does token-equality (auto-detect.ts:matchesPattern) so
-- short single-word patterns like 'pet'/'cat'/'vet' only fire when the
-- vendor name tokenises to one of those tokens (e.g. "cat food", not
-- "Petron" or "vacation"). The seeds below are intentionally narrow
-- multi-word phrases for extra safety on short tokens.
--
-- ON CONFLICT not used because (user_id, pattern, match_kind) isn't unique
-- by design (the user may want multiple variants of a pattern). The
-- migration is one-shot at apply time; running again would duplicate rows.
do $$
declare
  u_id uuid;
begin
  for u_id in select id from auth.users loop
    -- Skip if this user already has seeded rules (idempotency safety).
    if not exists (
      select 1 from finance.sadaka_auto_rules
      where user_id = u_id
    ) then
      insert into finance.sadaka_auto_rules (user_id, match_kind, pattern, active, label) values
        (u_id, 'category',       'pets',         true, 'Cat & pet category'),
        (u_id, 'vendor_pattern', 'pet shop',     true, 'Pet shop'),
        (u_id, 'vendor_pattern', 'pet food',     true, 'Pet food'),
        (u_id, 'vendor_pattern', 'vet clinic',   true, 'Vet clinic'),
        (u_id, 'vendor_pattern', 'animal',       true, 'Animal-related vendor');
    end if;
  end loop;
end;
$$;

-- Auto-seed on signup so new users get the same starter rules as existing
-- ones. Wrapped in its own trigger to keep 0071's trigger single-purpose.
create or replace function finance.sadaka_auto_rules_seed_for_user()
returns trigger
language plpgsql
security definer
set search_path = public, finance
as $$
begin
  insert into finance.sadaka_auto_rules (user_id, match_kind, pattern, active, label) values
    (new.id, 'category',       'pets',         true, 'Cat & pet category'),
    (new.id, 'vendor_pattern', 'pet shop',     true, 'Pet shop'),
    (new.id, 'vendor_pattern', 'pet food',     true, 'Pet food'),
    (new.id, 'vendor_pattern', 'vet clinic',   true, 'Vet clinic'),
    (new.id, 'vendor_pattern', 'animal',       true, 'Animal-related vendor');
  return new;
end;
$$;

drop trigger if exists sadaka_auto_rules_seed_trg on auth.users;
create trigger sadaka_auto_rules_seed_trg
  after insert on auth.users
  for each row
  execute function finance.sadaka_auto_rules_seed_for_user();

-- Entities flag for mechanism #3 — transfers to flagged people.
alter table finance.entities
  add column if not exists sadaka_recipient boolean not null default false;

create index if not exists entities_sadaka_recipient_idx
  on finance.entities (user_id)
  where sadaka_recipient = true;
