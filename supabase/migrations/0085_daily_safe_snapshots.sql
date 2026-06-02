-- Freelane: daily safe-to-spend snapshots (BUG FIX #2 — LIVE DAILY SAFE).
--
-- Pre-0085 bug: the Spend modal + Today's Safe-to-Spend widget displayed
-- a START-OF-DAY value computed at first render and never decremented
-- when subsequent spends were logged. Example: ₱500 safe at 9am, ₱200
-- spent at noon, modal at 5pm STILL read ₱500.
--
-- New model: computeSafeToSpend({...}) returns two distinct numbers:
--   initialForToday  — PHT-day-anchored snapshot computed once per day,
--                      stored in this table, stable until midnight PHT.
--   liveRemaining    — initialForToday MINUS the sum of today's spends
--                      (PHT-bounded), recomputed on every render and
--                      every spend-log mutation.
--
-- Display rule everywhere (Spend modal, Today widget, Spending top hero):
--   Hero    = liveRemaining (NumberFlow)
--   Subtitle (greyed, small) = "started today at ₱{initialForToday}"
--
-- The snapshot is keyed (user_id, pht_date) so there is at most one row
-- per user per PHT day. Writes happen on first read of the day (via the
-- DAILY_SAFE_INITIAL brain cache wrapper) and survive until the next
-- PHT-midnight rollover.

create table if not exists finance.daily_safe_snapshots (
  user_id            uuid not null references auth.users(id) on delete cascade,
  pht_date           date not null,
  initial_safe_base  numeric not null,
  currency           text not null,
  computed_at        timestamptz not null default now(),
  primary key (user_id, pht_date)
);

comment on table finance.daily_safe_snapshots is
  'PHT-anchored snapshot of the day''s starting safe-to-spend. initialForToday in the computeSafeToSpend contract — stable across the PHT day, never moves with intraday spends.';

alter table finance.daily_safe_snapshots enable row level security;

create policy "daily_safe_snapshots_owner_select"
  on finance.daily_safe_snapshots
  for select
  using (auth.uid() = user_id);

create policy "daily_safe_snapshots_owner_insert"
  on finance.daily_safe_snapshots
  for insert
  with check (auth.uid() = user_id);

create policy "daily_safe_snapshots_owner_update"
  on finance.daily_safe_snapshots
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "daily_safe_snapshots_owner_delete"
  on finance.daily_safe_snapshots
  for delete
  using (auth.uid() = user_id);

create index if not exists daily_safe_snapshots_user_date_idx
  on finance.daily_safe_snapshots (user_id, pht_date desc);
