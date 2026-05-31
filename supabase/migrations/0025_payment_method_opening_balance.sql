-- Freelane: payment_methods opening balance snapshot.
--
-- When Max first sets up Freelane, his wallets already have money in them —
-- coin.ph might already hold ₱8,400, Cash might have ₱2,300 in his pocket, the
-- bank account might be sitting on ₱15,000. Past payment-chain rows and
-- withdrawals only capture what flowed THROUGH the app from that point
-- forward; they say nothing about the balance that was already there at
-- start. Without this snapshot, every holding-wallet balance reads ₱0 at
-- launch and only grows from new activity, which is wrong.
--
-- This pair of columns lets him record the opening balance ONCE, per wallet,
-- the day he sets it. nullable means "I didn't bother / it was zero" — the
-- math treats null as 0.
--
-- Formula update for the holdingBalances() function in TS:
--   balance = coalesce(opening_balance_base, 0) + received - withdrawn - spent
-- where received / withdrawn / spent are the existing PHP-denominated sums.

alter table finance.payment_methods
  add column if not exists opening_balance_base numeric(14, 2);

alter table finance.payment_methods
  add column if not exists opening_balance_at date;
