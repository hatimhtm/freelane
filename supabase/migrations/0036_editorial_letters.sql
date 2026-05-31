-- Freelane: editorial letters layer (Tier 3).
--
-- Hatim's voice is the soul of the OS. Tier 3 adds the AI-written editorial
-- surface: monthly letters, weekly Sunday letters, the Year Letter (Dec 31),
-- the Spotlight of the Month, Anniversary Witness ("one year ago today"),
-- and the Year-Mark of Regret (every 2 months). ALL of these are letters
-- in one table, distinguished by kind.
--
-- Each letter is the AI's quiet narrative naming of what just happened. NOT
-- a report. NOT a forecast. A LETTER — short, observational, freelancer
-- voice. The user can pin one ("I want to keep this") + reply ("a note back
-- to your past self") that feeds into user_memory.
--
-- kind values:
--   end_of_month       — generated on the 1st of each month for the prior month
--   spotlight          — one framed moment per month (paired with end_of_month)
--   sunday             — weekly Sunday letter
--   year               — Dec 31 letter for the closing year
--   anniversary        — "one year ago today" witness, surfaced on the anchor day
--   regret_mark        — every 2 months, surfaces unresolved regrets (#9 modified)
--
-- period_key: the calendar bucket this letter belongs to.
--   end_of_month / spotlight     → "YYYY-MM"   (the month being looked back on)
--   sunday                       → "YYYY-Www"  (the ISO week the Sunday closes)
--   year                         → "YYYY"      (the closing year)
--   anniversary                  → "YYYY-MM-DD" (the anchor day)
--   regret_mark                  → "YYYY-MM"   (the 2-month bucket end month)
--
-- One letter per (user, kind, period_key). The generator upserts; re-runs
-- regenerate the same letter (e.g. if Hatim edits inputs after the 1st).

create type finance.editorial_letter_kind as enum (
  'end_of_month',
  'spotlight',
  'sunday',
  'year',
  'anniversary',
  'regret_mark'
);

create table if not exists finance.letters (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  kind            finance.editorial_letter_kind not null,
  period_key      text not null,
  -- The headline — 8-16 words, evocative + specific. Always present.
  headline        text not null,
  -- The body — markdown. End-of-Month / Year / Sunday letters run 100-250
  -- words; Spotlight ~80; Anniversary 40-80; Regret 60-120.
  body            text not null,
  -- Optional structured blocks the UI renders as call-outs under the body.
  -- Loose jsonb. Shape varies per kind:
  --   spotlight: { vendor?, amount_base?, date?, note? }
  --   anniversary: { reference_event: {kind, label, date_then}, then_value, now_value }
  --   regret_mark: { items: [{label, why_open, action_chips: []}] }
  blocks          jsonb not null default '{}'::jsonb,
  -- Input snapshot — the AI's input data at generation time, for audit + the
  -- "why did the letter say that?" affordance.
  input_snapshot  jsonb not null default '{}'::jsonb,
  -- 0-1 confidence — used by the UI to gentle-hedge in copy when low.
  confidence      numeric(3, 2) not null default 0.5 check (confidence between 0 and 1),
  model_version   text not null default '1',
  pinned          boolean not null default false,
  -- Hatim's reply note back. Folded into user_memory_entries on save.
  reply           text,
  replied_at      timestamptz,
  generated_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, kind, period_key)
);

create index if not exists letters_user_kind_idx
  on finance.letters (user_id, kind, generated_at desc);

create index if not exists letters_pinned_idx
  on finance.letters (user_id, generated_at desc)
  where pinned = true;

create trigger letters_touch
  before update on finance.letters
  for each row execute function finance.touch_updated_at();

alter table finance.letters enable row level security;

create policy "owner_all" on finance.letters
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
