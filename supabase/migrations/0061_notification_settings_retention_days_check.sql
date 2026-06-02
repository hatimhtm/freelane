-- Freelane Notifications — DB-level guard on retention_days.
--
-- Migration 0057 left retention_days as an unconstrained int with a default
-- of 3. The UI dropdown only ever writes 1, 3, 7, 30, or "forever" (which
-- becomes retention_forever=true), so in practice the column is always a
-- sensible positive integer. But a buggy client — or a hand-rolled
-- service-role write — could land 0 or a negative number, which the
-- retention RPC would then silently coerce to 1 via greatest(...,1).
-- That coercion is good defense-in-depth, but the invariant belongs in
-- the schema too: retention_days must be a positive day-count, capped at
-- ten years (3650 days) so we never accidentally encode "essentially
-- forever" as a finite integer instead of the dedicated retention_forever
-- flag.
--
-- NOT VALID + VALIDATE keeps the lock window short on tables with rows;
-- safe even if 0057's defaults filled in 3 everywhere.

alter table finance.notification_settings
  add constraint notification_settings_retention_days_positive
  check (retention_days > 0 and retention_days <= 3650)
  not valid;

alter table finance.notification_settings
  validate constraint notification_settings_retention_days_positive;
