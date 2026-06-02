-- Freelane: spends.is_sadaka explicit flag.
--
-- The spend modal grows a "Mark as sadaka" Switch — toggling it on writes
-- a sadaka_ledger payment row tied to the spend, AND a money_ledger
-- sadaka_payment row mirroring the outflow side. This column is the durable
-- truth the explicit toggle writes against so:
--
--   1. Auto-detection can SHORT-CIRCUIT when is_sadaka=true (the explicit
--      toggle overrides every auto rule).
--   2. Un-toggling on edit archives the existing sadaka_ledger payment row
--      via the (source_kind, source_id) partial unique.
--   3. The Activity feed can render a clean "marked sadaka" subline distinct
--      from auto-detected rows.

alter table finance.spends
  add column if not exists is_sadaka boolean not null default false;

create index if not exists spends_is_sadaka_idx
  on finance.spends (user_id)
  where is_sadaka = true;
