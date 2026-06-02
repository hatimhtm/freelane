-- Freelane: audience tag seeds on signup (fixes finding from 0083 verifier).
--
-- Migration 0083 seeded the 4 audience rows (All / Business / Personal /
-- For us) ONLY for users that existed at apply time, via a one-shot DO
-- block. Anyone who signs up after 0083 ships has zero audience-kind
-- rows, which silently breaks the "audience as primary filter axis"
-- invariant in Spending — spending-view.tsx would build audienceTagIds
-- of all nulls and fall back to the legacy business_relevant / for_us
-- booleans.
--
-- Fix: install an after-insert trigger on auth.users that inserts the
-- four pinned + immutable audience seeds at signup, mirroring the
-- pattern in migrations 0059 (notification_settings) and 0071
-- (sadaka_config).

create or replace function finance.audience_tags_seed_for_user()
returns trigger
language plpgsql
security definer
set search_path = public, finance
as $$
begin
  insert into finance.spend_categories
    (user_id, name, tag_kind, pinned, created_by_user, sort_order, archived)
  values
    (new.id, 'All',      'audience', true, false, -40, false),
    (new.id, 'Business', 'audience', true, false, -30, false),
    (new.id, 'Personal', 'audience', true, false, -20, false),
    (new.id, 'For us',   'audience', true, false, -10, false)
  on conflict (user_id, name) do nothing;
  return new;
end;
$$;

drop trigger if exists audience_tags_seed_trg on auth.users;
create trigger audience_tags_seed_trg
  after insert on auth.users
  for each row
  execute function finance.audience_tags_seed_for_user();

-- Re-run the original 0083 backfill in case any new users slipped in
-- between 0083 apply and this migration. Idempotent.
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
