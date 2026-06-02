-- Freelane: per-wallet overdraft tolerance (₱ base).
--
-- Display + alarm threshold only. The wallet may go below zero by this many
-- pesos before the over-overdraft alarm fires (rose). Between 0 and
-- -tolerance the wallet still renders, just in terracotta as a soft signal.
--
-- IMPORTANT: this is NOT spendable headroom. safe-to-spend math treats the
-- wallet at its actual (possibly negative) balance — tolerance never inflates
-- the available number. The COL floor and the holding-balance math are
-- untouched.
--
-- Example: GCash with tolerance 500 → balance of -200 paints terracotta,
-- -600 paints rose. The safe-to-spend headline still uses -200 / -600 as the
-- input, not 300 / -100.

alter table finance.payment_methods
  add column if not exists overdraft_tolerance_base numeric not null default 0
    check (overdraft_tolerance_base >= 0);

comment on column finance.payment_methods.overdraft_tolerance_base is
  'How far below zero this wallet may go before raising the over-overdraft alarm. Display + alarm threshold only — safe-to-spend treats the wallet at its actual (possibly negative) balance.';
