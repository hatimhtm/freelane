-- Mark a payment's fee as "unknown" so the fee algorithm IGNORES it entirely
-- (rather than treating it as a real 0, which would make a route look cheaper
-- than it is). Used for old payments where the exact received amount isn't
-- remembered. Defaults to false so all existing data still counts.
alter table finance.payments
  add column if not exists fee_unknown boolean not null default false;
