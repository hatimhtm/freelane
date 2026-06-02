-- Freelane: clarify the no-backfill contract on the native opening-balance
-- columns introduced in 0047. Comment-only — the columns themselves were
-- sealed in 0047 and stay as-is.
--
-- Why a follow-up migration instead of editing 0047: once a migration is
-- applied to production its file is authoritative history. Rewriting comments
-- on a sealed file creates drift between the recorded migration row and the
-- file on disk. The clarifying note lives here so future readers see the same
-- text the DB sees.

comment on column finance.payment_methods.opening_balance_amount is
  'Native opening-balance amount as the user typed it (e.g. 1500 for MAD 1500). Paired with opening_balance_currency. NO backfill from 0047: existing rows land NULL because the original native amount is unrecoverable from the PHP-equivalent opening_balance_base; the UI falls back to currency_out and prompts re-anchor.';

comment on column finance.payment_methods.opening_balance_currency is
  'Native currency for opening_balance_amount (e.g. "MAD", "USDT"). NULL on pre-0047 rows that were not re-anchored — UI falls back to currency_out for display.';
