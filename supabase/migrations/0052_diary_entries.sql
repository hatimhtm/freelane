-- Freelane: daily diary — freeform body + optional mood (1-5) + optional
-- energy (1-5). Replaces the weekly intent_mirror grain with a daily grain
-- the user writes themselves. NO AI mirror — pure user-written.
--
-- ONE row per (user, day): the PK enforces upsert-on-save. body defaults to
-- the empty string so the row can exist with only a mood/energy logged.

create table if not exists finance.diary_entries (
  id          uuid not null default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  entry_date  date not null,
  body        text not null default '',
  mood        smallint check (mood between 1 and 5),
  energy      smallint check (energy between 1 and 5),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, entry_date)
);

create index if not exists diary_entries_recent_idx
  on finance.diary_entries (user_id, entry_date desc);

alter table finance.diary_entries enable row level security;

create policy "owner_all" on finance.diary_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
