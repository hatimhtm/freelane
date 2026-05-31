-- Freelane: Tuesday Check-In (Tier 5 — #15).
--
-- Hatim 2026-06-01: "Weekly soft footer prompt under safe-to-spend. Private
-- emotional ledger." NOT therapy. NOT a mood tracker. A small place to write
-- a line about the week as it actually felt — money + life + body.
--
-- Surfaces on Today as a quiet card. The AI brain reads the entry + the
-- week's money shape and writes back ONE observational sentence that
-- folds into user_memory.
--
-- One row per (user, week_starts Monday). Re-submitting updates the row.

create table if not exists finance.wellbeing_checkins (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  week_starts   date not null,                       -- Monday of the week
  -- User-facing question the AI asked this week. Persisted so the user can
  -- see what they were answering when they look back later.
  prompt        text,
  -- Hatim's freeform response.
  response      text,
  -- 1-5 scalars for the soft footer pills. All nullable; user can pick zero.
  mood          integer check (mood is null or (mood between 1 and 5)),
  energy        integer check (energy is null or (energy between 1 and 5)),
  -- AI's quiet observation back. Folded into user_memory_entries on save.
  echo          text,
  generated_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, week_starts)
);

create index if not exists wellbeing_checkins_user_idx
  on finance.wellbeing_checkins (user_id, week_starts desc);

create trigger wellbeing_checkins_touch
  before update on finance.wellbeing_checkins
  for each row execute function finance.touch_updated_at();

alter table finance.wellbeing_checkins enable row level security;

create policy "owner_all" on finance.wellbeing_checkins
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
