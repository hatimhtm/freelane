-- Freelane: payment methods.
--
-- Receiving money is rarely one hop. A CNY invoice can land via:
--   bank wire → RedDot (crypto) → GCash (PHP) → my wallet
-- We model each "rail" once here, then payment_steps (0011) chains them.
--
-- Each method may carry a flat monthly fee (only the one bank that charges
-- a maintenance fee, today). Per-transaction fees aren't stored — they're
-- inferred from each payment_step's amount_in vs amount_out.

create type finance.payment_method_kind as enum (
  'bank',      -- direct bank wire / SEPA / ACH
  'wallet',    -- GCash, Wise, Payoneer, PayPal, Revolut
  'exchange',  -- crypto on/off-ramp (RedDot, P2P, etc.)
  'crypto',    -- self-custody chain (USDT, USDC, BTC)
  'cash',      -- physical
  'other'
);

create table if not exists finance.payment_methods (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  name              text not null,
  kind              finance.payment_method_kind not null default 'wallet',
  -- The "shape" of money it accepts/produces. Null = any.
  -- Used by chain validation + Gemini routing suggestions.
  currency_in       text references finance.currencies(code),
  currency_out      text references finance.currencies(code),
  monthly_fee_php   numeric(12, 2) not null default 0 check (monthly_fee_php >= 0),
  notes             text,
  archived          boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists payment_methods_user_idx
  on finance.payment_methods (user_id)
  where archived = false;

create trigger payment_methods_touch
  before update on finance.payment_methods
  for each row execute function finance.touch_updated_at();

alter table finance.payment_methods enable row level security;

create policy "owner_all" on finance.payment_methods
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── Seed a sensible starter set for every existing user ────────────────
--
-- These are best guesses based on the user's stated rails. They can be
-- renamed, deleted, or annotated post-migration. Idempotent on (user_id, name).

insert into finance.payment_methods (user_id, name, kind, currency_in, currency_out, notes)
select s.user_id, m.name, m.kind::finance.payment_method_kind, m.currency_in, m.currency_out, m.notes
from finance.settings s
cross join (values
  ('Wise',                      'wallet',   null::text, null::text, 'Multi-currency wallet, usually cheapest mid-market FX.'),
  ('Payoneer',                  'wallet',   null::text, null::text, 'Common payout rail from agencies.'),
  ('PayPal',                    'wallet',   null::text, null::text, 'Pricey FX. Avoid if there''s a cheaper path.'),
  ('GCash',                     'wallet',   'PHP',      'PHP',      'PH local wallet. Often the final hop to PHP.'),
  ('RedDot',                    'exchange', null::text, null::text, 'Crypto on/off-ramp used in some chains.'),
  ('Bank wire — primary',       'bank',     null::text, 'PHP',      'The bank with the monthly maintenance fee. Set monthly_fee_php in Settings.'),
  ('Bank wire — other',         'bank',     null::text, 'PHP',      'Any other direct bank transfer.'),
  ('Western Union',             'wallet',   null::text, 'PHP',      'Cash pickup. Rarely the cheapest.'),
  ('USDT',                      'crypto',   null::text, null::text, 'Tether. Common in CNY/MAD corridors.'),
  ('USDC',                      'crypto',   null::text, null::text, 'USD Coin.')
) as m(name, kind, currency_in, currency_out, notes)
on conflict (user_id, name) do nothing;
