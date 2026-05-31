-- Freelane: morning log (Tier 4 — #4 Sleep × Spend Echo).
--
-- Hatim 2026-06-01: "ship as NOTIFICATION → tap → small center modal".
-- The data model is the same regardless: one row per morning, three quick
-- fields (sleep, mood, mind). The Sleep × Spend Echo brain reads these +
-- the day's spends to write a quiet echo line ("Slept 5h, ordered three
-- times — possibly tied").
--
-- One row per (user_id, recorded_at). The mood_band is intentionally tight
-- (1-5) — not free-text, the user picks one of five buttons. mind_state is
-- a single short freeform line ("scattered", "calm but tired", etc.) so
-- the brain has a verbal hook beyond the integer mood.

create table if not exists finance.morning_log (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  recorded_at   date not null default current_date,
  -- Hours slept last night. Nullable when the user opens the prompt and
  -- only logs mood + mind.
  slept_hours   numeric(4, 2) check (slept_hours is null or (slept_hours >= 0 and slept_hours <= 24)),
  -- 1 = rough, 5 = great. Nullable for the same reason.
  mood_band     integer check (mood_band is null or (mood_band between 1 and 5)),
  -- Short freeform line.
  mind_state    text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, recorded_at)
);

create index if not exists morning_log_user_idx
  on finance.morning_log (user_id, recorded_at desc);

create trigger morning_log_touch
  before update on finance.morning_log
  for each row execute function finance.touch_updated_at();

alter table finance.morning_log enable row level security;

create policy "owner_all" on finance.morning_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
