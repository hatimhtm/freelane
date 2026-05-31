-- Freelane: intent mirror (Tier 4 — #36 Journal vs Spend Reality Mirror).
--
-- Hatim 2026-06-01: "framed as gentle push toward saving for building a
-- family". Once a week, Hatim writes a short intention paragraph for the
-- week ("planning to slow on fast food and tuck ₱2,000 toward the
-- household"). The mirror brain reads the WEEK that just ended and writes
-- back what actually happened — without judgment.
--
-- One row per (user_id, week_starts). week_starts is the Monday of the
-- week. intentions is the user-written input; reality_snapshot is the
-- AI-built snapshot at week-end; narrative is the AI mirror line.

create table if not exists finance.intent_mirror (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  week_starts       date not null,                 -- Monday of the week
  -- User-written intentions (free-form text or jsonb shape — kept loose).
  -- Example shape: { focus: "slowing fast food", family_target_php: 2000, watch: ["cigarettes"] }
  intentions        jsonb not null default '{}'::jsonb,
  intentions_text   text,
  -- AI-built snapshot of how the week actually went.
  reality_snapshot  jsonb not null default '{}'::jsonb,
  -- AI-written mirror paragraph. Gentle nudge toward saving for building
  -- the household — NEVER preachy, never accusatory.
  narrative         text,
  -- 0-1 confidence.
  confidence        numeric(3, 2) not null default 0.5 check (confidence between 0 and 1),
  generated_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, week_starts)
);

create index if not exists intent_mirror_user_idx
  on finance.intent_mirror (user_id, week_starts desc);

create trigger intent_mirror_touch
  before update on finance.intent_mirror
  for each row execute function finance.touch_updated_at();

alter table finance.intent_mirror enable row level security;

create policy "owner_all" on finance.intent_mirror
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
