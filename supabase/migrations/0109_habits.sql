-- Freelane: Habits — checked-off-per-day rituals living inside
-- Body & Wellbeing (Settings tab #4).
--
-- TWO tables:
--   finance.habits          — the habit definition (name + cadence + target)
--   finance.habit_entries   — per-day check-off rows (UNIQUE (habit_id,
--                             completed_on) so a habit can only be marked
--                             done ONCE per day)
--
-- Cadence is text-with-CHECK rather than an enum so future cadences
-- ('biweekly', 'monthly') can be added without an enum-alter dance.
--
-- archived_at on habits is a soft-delete so historical entries survive
-- (Activity feed + Stats can still surface a habit the user has since
-- retired). Live readers filter archived_at IS NULL.

create table if not exists finance.habits (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  name              text not null,
  cadence           text not null default 'daily'
    check (cadence in ('daily', 'weekly', 'custom')),
  target            integer not null default 1 check (target > 0),
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists habits_user_idx
  on finance.habits (user_id)
  where archived_at is null;

alter table finance.habits enable row level security;

create policy "owner_all" on finance.habits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function finance.tg_habits_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists habits_touch on finance.habits;

create trigger habits_touch
  before update on finance.habits
  for each row execute function finance.tg_habits_touch_updated_at();

-- ── finance.habit_entries — per-day check-off rows ─────────────────────

create table if not exists finance.habit_entries (
  id            uuid primary key default gen_random_uuid(),
  habit_id      uuid not null references finance.habits(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  completed_on  date not null,
  created_at    timestamptz not null default now(),
  unique (habit_id, completed_on)
);

create index if not exists habit_entries_habit_day_idx
  on finance.habit_entries (habit_id, completed_on desc);

create index if not exists habit_entries_user_day_idx
  on finance.habit_entries (user_id, completed_on desc);

alter table finance.habit_entries enable row level security;

create policy "owner_all" on finance.habit_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
