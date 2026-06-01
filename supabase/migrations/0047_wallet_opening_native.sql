-- Store the wallet's opening balance in its native currency so the UI can
-- echo back exactly what the user typed (e.g. "MAD 1500", "USDT 50"). The
-- existing opening_balance_base stays as the PHP-equivalent that the math
-- layer reads. Both populate at save time so historical FX drift doesn't
-- silently rewrite what the user originally entered.

alter table finance.payment_methods
  add column if not exists opening_balance_amount    numeric(16, 4),
  add column if not exists opening_balance_currency  text;

-- Backfill from the existing base column on the first run only — the value
-- might be a PHP equiv that's already been converted from MAD/USDT at save
-- time, but we have no native amount to recover. Leave currency null on
-- existing rows so the UI can fall back to currency_out and the form prompts
-- the user to re-anchor when they edit.
