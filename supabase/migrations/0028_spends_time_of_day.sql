-- Freelane: time-of-day on spends.
--
-- spends.spent_at is a DATE — fine for the calendar dimension but it loses the
-- hour. Late-Night Spend Cluster (#32), Post-Payday Surge Window (#35), and
-- Time-of-Day Fingerprint analysis all need hour-of-day. Rather than convert
-- spent_at to timestamptz (breaks every existing query + index), this adds a
-- nullable spent_time column kept beside spent_at.
--
-- Read order for any "when did this happen" query:
--   1. spent_at + spent_time, if spent_time is not null
--   2. spent_at as date-only otherwise (legacy / unknown hour)
--
-- The spend modal defaults spent_time to current local time when logging
-- live, leaves it null when backdating from home (user can fill in if they
-- remember, or leave it as a date-only entry).

alter table finance.spends
  add column if not exists spent_time time;

-- Partial index for the analyses that filter to hour-precise rows.
create index if not exists spends_time_of_day_idx
  on finance.spends (user_id, spent_at, spent_time)
  where spent_time is not null;
