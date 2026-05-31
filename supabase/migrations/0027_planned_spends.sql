-- Freelane: planned_spends — intent rows for future outflows.
--
-- The MacBook arriving in ~3 days. The Apple Developer renewal at $99/yr in
-- August. Eid preparation 60 days out. None of these are spends YET; they
-- aren't recurring (one-shot decisions); but the runway math should treat
-- them as if they were already on the calendar — otherwise safe-to-spend
-- looks rosier than it is. That's what planned_spends solves.
--
-- Lifecycle:
--   planned    — intent declared; counts against runway, not against spend total
--   committed  — Pre-Commitment Runway Lock has parked the money; sits in a
--                holding wallet earmarked, can't be touched casually
--   done       — materialized; done_spend_id points at the real spends row
--   cancelled  — abandoned; no longer counts against runway
--
-- certainty drives how the AI weighs it:
--   firm     — definitely happening on planned_for (MacBook arriving, rent)
--   probable — likely on a window (Apple Dev renewal, Eid)
--   maybe    — speculative ("considering a chair")
--
-- is_big_plan flags rows that drive Pre-Mortem (anything > 7d safe-to-spend
-- at the current burn rate counts as "big" by default; user can also flag
-- explicitly).
--
-- Notes column is mandatory from day-one per the universal notes rule
-- (Hatim 2026-06-01).

create type finance.planned_spend_status as enum (
  'planned', 'committed', 'done', 'cancelled'
);

create type finance.planned_spend_certainty as enum (
  'firm', 'probable', 'maybe'
);

create table if not exists finance.planned_spends (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  label               text not null,                                  -- "MacBook M3 Pro"
  expected_amount     numeric(14, 2) not null check (expected_amount > 0),
  expected_currency   text not null references finance.currencies(code),
  -- PHP-equivalent locked at row-creation time. Stays stable when the user
  -- looks at the row later, even if FX has moved. Recomputed only on update.
  expected_base       numeric(14, 2) not null check (expected_base >= 0),
  planned_for         date not null,
  planned_for_window_days  integer not null default 0 check (planned_for_window_days >= 0),
  certainty           finance.planned_spend_certainty not null default 'firm',
  status              finance.planned_spend_status not null default 'planned',
  -- Optional wallet the user intends to spend FROM. When status flips to
  -- 'committed', this is where the lock parks the money.
  wallet_id           uuid references finance.payment_methods(id) on delete set null,
  -- Default category tags to seed when the planned spend materializes.
  default_category_ids jsonb not null default '[]'::jsonb,
  -- Big-plan flag. Either user-set or AI-suggested when expected_base exceeds
  -- a heuristic threshold (~7d burn).
  is_big_plan         boolean not null default false,
  -- Once status='committed', this is the locked PHP amount + when the lock
  -- was placed. Allows the Pre-Commitment Runway math to subtract it from
  -- the holding-wallet "spendable" surface without removing it from the
  -- raw balance (the money is still THERE, just earmarked).
  committed_base      numeric(14, 2),
  committed_at        timestamptz,
  -- When status='done', points at the real spends row that fulfilled it.
  done_spend_id       uuid references finance.spends(id) on delete set null,
  done_at             timestamptz,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Hot path: the planning surface lists open intent rows by planned_for date.
create index if not exists planned_spends_open_idx
  on finance.planned_spends (user_id, planned_for)
  where status in ('planned', 'committed');

-- All-rows-by-user index for full /plans page.
create index if not exists planned_spends_user_idx
  on finance.planned_spends (user_id, created_at desc);

-- Pre-Mortem reads big plans specifically.
create index if not exists planned_spends_big_idx
  on finance.planned_spends (user_id, planned_for)
  where is_big_plan = true and status in ('planned', 'committed');

create trigger planned_spends_touch
  before update on finance.planned_spends
  for each row execute function finance.touch_updated_at();

alter table finance.planned_spends enable row level security;

create policy "owner_all" on finance.planned_spends
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Seed Hatim's two known planned outflows. Per memory: ₱70k MacBook arriving
-- ~2026-06-04 and $99 Apple Developer renewal. Don't seed if rows with the
-- same label already exist for this user.
insert into finance.planned_spends (
  user_id, label, expected_amount, expected_currency, expected_base,
  planned_for, planned_for_window_days, certainty, status, is_big_plan, notes
)
select s.user_id, v.label, v.expected_amount, v.expected_currency, v.expected_base,
       v.planned_for, v.window_days, v.certainty::finance.planned_spend_certainty,
       'planned'::finance.planned_spend_status, v.big, v.notes
from finance.settings s
cross join (values
  ('MacBook M3 Pro',         70000, 'PHP', 70000, current_date + interval '4 days',  2, 'firm',     true,  'Replaces 2017 MacBook. Earns back ~20× as a dev tool — counts as Investment.'),
  ('Apple Developer Renewal', 99,   'USD',  5500, date '2026-08-15',                 7, 'probable', false, 'Annual $99 renewal. Business-relevant. FX of ~₱55.5/USD for the base estimate.')
) as v(label, expected_amount, expected_currency, expected_base, planned_for, window_days, certainty, big, notes)
where not exists (
  select 1 from finance.planned_spends p
   where p.user_id = s.user_id and p.label = v.label
);
