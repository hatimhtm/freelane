-- Freelane: wallet_platform_metadata (Payments workflow).
--
-- Reference table the chatbot reads when answering withdrawal-routing
-- ("cheapest way to get paid", "should I withdraw via coin.ph or Wise?")
-- questions. Replaces the deleted on-page "Cheapest ways" leaderboard —
-- the knowledge moves into the AI, not into a wide card.
--
-- One row per canonical brand_key. Fees + speed are TYPICAL rails (not
-- per-transaction live rates) so the chatbot can speak in usual ranges
-- without needing fresh oracle data. Seeded for the 6 brand_keys we ship
-- with; new wallets ship a row alongside their brand registry entry.
--
-- Read policy is open-to-all-authenticated (this is reference data, not
-- per-user). Mutations are server-only — no client write policy.

-- typical_fee_fraction is stored as a fraction in [0,1] (0.006 = 0.6%, NOT
-- the percent itself). Same units as paymentFee()'s `pct` field in
-- payment-chain.ts so the chatbot payload can mix typical-vs-actual
-- without a 100x unit clash.
create table if not exists finance.wallet_platform_metadata (
  brand_key                 text primary key,
  display_name              text not null,
  platform_type             text not null check (platform_type in ('crypto','ewallet','bank','remittance','cash')),
  base_currency             text,
  typical_fee_fraction      numeric,
  typical_fee_flat_php      numeric,
  typical_speed_hours       numeric,
  supports_inbound          boolean not null default true,
  supports_outbound         boolean not null default true,
  notes                     text,
  updated_at                timestamptz not null default now()
);

comment on table finance.wallet_platform_metadata is
  'Reference data per wallet brand. Read by the chatbot for withdrawal-routing context. typical_fee_fraction is a [0,1] fraction (NOT a percent) so it shares units with paymentFee().pct.';

alter table finance.wallet_platform_metadata enable row level security;

-- Read-all for any authenticated user — this is reference, not per-user.
create policy "wallet_platform_metadata_read_all"
  on finance.wallet_platform_metadata
  for select
  to authenticated
  using (true);

-- No write policy: mutations happen via service role only. Belt-and-
-- suspenders REVOKE so a future permissive policy added by mistake
-- doesn't accidentally open the table to authenticated writes.
revoke insert, update, delete on finance.wallet_platform_metadata from authenticated;

-- Seed the 6 canonical wallets. Fee fractions, NOT percents (0.006 = 0.6%,
-- 0.035 = 3.5%). ON CONFLICT DO NOTHING keeps re-runs idempotent.
insert into finance.wallet_platform_metadata
  (brand_key, display_name, platform_type, base_currency, typical_fee_fraction, typical_fee_flat_php, typical_speed_hours, supports_inbound, supports_outbound, notes)
values
  ('coin_ph',  'coin.ph',  'crypto',     'PHP', 0.0,    10,   1.0,  true, true,  'USDT on-ramp into PHP via PDAX-style rails. ₱10 flat withdrawal fee to GCash / bank.'),
  ('gcash',    'GCash',    'ewallet',    'PHP', 0.0,     0,   0.25, true, true,  'PH-native e-wallet. Inbound free from coin.ph. Cash-out fees apply at partner outlets.'),
  ('wise',     'Wise',     'remittance', 'USD', 0.006,   0,   24.0, true, true,  'USD → PHP conversion at mid-market with ~0.6% spread. 1-3 business day settlement.'),
  ('coinmama', 'Coinmama', 'crypto',     'USD', 0.035,   0,   2.0,  true, false, 'USD card buy of crypto. No native off-ramp on the user''s plan; user routes through Wise/coin.ph manually. Used as on-ramp for foreign-card-paid invoices.'),
  ('cfg_bank', 'CFG Bank', 'bank',       'PHP', 0.0,     0,   24.0, true, true,  'PH bank account. Used for long-term holding + bill pay. Withdrawals via ATM or wire.'),
  ('cash',     'Cash',     'cash',       'PHP', 0.0,     0,   0.0,  true, true,  'Physical cash. No rails — manual reconciliation against wallet anchor.')
on conflict (brand_key) do nothing;
