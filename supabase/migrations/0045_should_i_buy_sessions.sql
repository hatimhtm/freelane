-- Freelane: Should-I-Buy sessions (Tier 5 — final feature).
--
-- Quick decision aid. User types item + price + currency + optional notes;
-- the brain reads current safe-to-spend + planned spends + Calm Weather
-- state + user memory + recent income shape; returns ONE paragraph + a
-- 4-level verdict pill ("easy yes" / "fits the stretch" / "tight but
-- possible" / "not this stretch").
--
-- Persisting sessions lets the Year Letter say "you asked about a chair in
-- March, didn't buy, then asked again in September and did" — the corpus
-- becomes part of the editorial layer.

create table if not exists finance.should_i_buy_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  -- What the user is considering buying.
  item            text not null,
  amount          numeric(14, 2) not null check (amount > 0),
  currency        text not null references finance.currencies(code),
  -- PHP-equivalent locked at session time (so the corpus doesn't re-float
  -- a 6-month-old "should I buy this $99 thing" against today's FX).
  amount_base     numeric(14, 2) not null check (amount_base >= 0),
  -- Optional user note (context, urgency, what kind of decision this is).
  note            text,
  -- AI verdict pill: 'easy_yes' | 'fits_the_stretch' | 'tight_but_possible'
  -- | 'not_this_stretch'. Open text for future verdict shapes.
  verdict         text,
  -- AI paragraph: ≤ 80 words.
  narrative       text,
  -- 0-1 confidence.
  confidence      numeric(3, 2) check (confidence is null or (confidence between 0 and 1)),
  -- Did the user actually buy it (set by the user via a follow-up button)?
  -- null = no decision recorded, true = bought, false = decided no.
  bought          boolean,
  decided_at      timestamptz,
  -- Loose jsonb input snapshot (safe-to-spend, calm weather band, etc.).
  input_snapshot  jsonb not null default '{}'::jsonb,
  generated_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists should_i_buy_sessions_user_idx
  on finance.should_i_buy_sessions (user_id, created_at desc);

create trigger should_i_buy_sessions_touch
  before update on finance.should_i_buy_sessions
  for each row execute function finance.touch_updated_at();

alter table finance.should_i_buy_sessions enable row level security;

create policy "owner_all" on finance.should_i_buy_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
