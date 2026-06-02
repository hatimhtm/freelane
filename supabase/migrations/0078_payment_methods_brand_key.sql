-- Freelane: payment_methods.brand_key
--
-- Stable identity for wallet brand instead of fragile name-slug matching.
-- The 6 canonical brand keys map to the curated wallet brand registry in
-- src/lib/brand/wallets.ts:
--   coin_ph, gcash, cash, wise, coinmama, cfg_bank
--
-- Backfill is fuzzy on existing names. A wallet idiosyncratically named
-- (e.g. "My Coin Pocket") may stay NULL — the resolveWalletBrand fallback
-- still matches it at render time via name-slug, and the user can wire it
-- explicitly via the brand picker in Settings.

alter table finance.payment_methods
  add column if not exists brand_key text null;

comment on column finance.payment_methods.brand_key is
  'Stable wallet brand identifier (coin_ph, gcash, cash, wise, coinmama, cfg_bank). Resolves to the curated WALLET_BRANDS registry. NULL falls back to fuzzy name-slug matching at render time.';

-- Backfill — fuzzy slug match against canonical brand keys. Idempotent:
-- only touches rows where brand_key is still NULL.
update finance.payment_methods
set brand_key = case
  when lower(name) like '%coin%ph%'                                 then 'coin_ph'
  when lower(name) like '%gcash%'                                   then 'gcash'
  when lower(name) like '%wise%' or lower(name) like '%transferwise%' then 'wise'
  when lower(name) like '%coinmama%'                                then 'coinmama'
  when lower(name) like '%cfg%'                                     then 'cfg_bank'
  when lower(name) = 'cash' or lower(name) like '%cash%'            then 'cash'
  else null
end
where brand_key is null;
