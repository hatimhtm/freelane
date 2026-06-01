-- The anchor on payment_methods.opening_balance_at is a DATE chosen by the
-- user — fine for backdating but it can't distinguish "I anchored at 12pm
-- today" from "withdrawal logged at 11am today". Holding-balance math then
-- double-counts same-day pre-anchor activity because both rows compare
-- equal on date alone.
--
-- Add a dedicated TIMESTAMPTZ that snapshots the moment the user hit Save.
-- Holding-balance math compares each activity row's created_at against
-- this column when present; otherwise it falls back to a strict date
-- comparison (anchor day's activity is treated as pre-anchor history) so
-- legacy rows behave sensibly without a re-anchor.
--
-- We deliberately do NOT backfill this column. Existing rows fall through
-- to the date fallback, which already excludes same-day prior activity.
-- The first time the user re-saves an anchor it gets a precise timestamp,
-- and from that point on midday recalibrations behave exactly the way the
-- user expects: anything created before the save is history; anything
-- after counts forward.

alter table finance.payment_methods
  add column if not exists opening_balance_set_at timestamptz;
