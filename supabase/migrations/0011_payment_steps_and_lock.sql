-- Freelane: chain payments into ordered steps, freeze paid amounts in base.
--
-- Two changes that ship together:
--
-- 1. finance.payment_steps — every payment is a chain. Most chains are
--    one step long. Some are 3+ (bank → crypto exchange → wallet). Each
--    step captures method, amount_in, amount_out, and the implicit fee.
--
-- 2. finance.payments gains:
--       net_amount_base       — the actual PHP that landed (locked).
--       gross_at_market_base  — what it WOULD have been at mid-market FX
--                               on paid_at (snapshot). Used to compute
--                               total realized fee per payment.
--       implied_fee_base      — gross_at_market_base - net_amount_base.
--       fx_locked             — once true, dashboard math uses
--                               net_amount_base directly (no FX recompute).
--                               New rows: always true. Backfilled rows: true.
--
-- Why the lock: unpaid money fluctuates with market FX (that's correct —
-- the project amount in CNY is what you're owed). Paid money is in pesos
-- in your wallet — it can't fluctuate. The flag is the boundary.

create table if not exists finance.payment_steps (
  id              uuid primary key default gen_random_uuid(),
  payment_id      uuid not null references finance.payments(id) on delete cascade,
  step_order      integer not null check (step_order >= 1),
  method_id       uuid references finance.payment_methods(id) on delete set null,
  amount_in       numeric(18, 4) not null check (amount_in > 0),
  currency_in     text not null references finance.currencies(code),
  amount_out      numeric(18, 4) not null check (amount_out > 0),
  currency_out    text not null references finance.currencies(code),
  is_final        boolean not null default false,
  notes           text,
  created_at      timestamptz not null default now(),
  unique (payment_id, step_order)
);

create index if not exists payment_steps_payment_idx on finance.payment_steps (payment_id, step_order);
create index if not exists payment_steps_method_idx  on finance.payment_steps (method_id);

alter table finance.payment_steps enable row level security;

-- Access mirrors the parent payment.
create policy "owner_via_payment" on finance.payment_steps
  for all
  using (
    exists (select 1 from finance.payments p where p.id = payment_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from finance.payments p where p.id = payment_id and p.user_id = auth.uid())
  );

-- ── Lock fields on payments ────────────────────────────────────────────

alter table finance.payments
  add column if not exists net_amount_base       numeric(14, 2),
  add column if not exists gross_at_market_base  numeric(14, 2),
  add column if not exists implied_fee_base      numeric(14, 2),
  add column if not exists fx_locked             boolean not null default false;

create index if not exists payments_method_via_steps_idx
  on finance.payment_steps (method_id, created_at desc);

-- ── Backfill existing payments as 1-step chains, snapshotted + locked ──
--
-- For every existing payment that lacks a net_amount_base, compute it
-- from the user's CURRENT exchange_rates table. This is a best-effort
-- snapshot — historical mid-market data isn't available, so we use
-- "today's rate × the amount that was paid then" as the locked figure.
-- The user can override per-payment afterwards.
--
-- Insert one payment_step per payment (1-step chain) so the new code path
-- has a uniform shape to query against.

with rates as (
  select user_id, code, rate_to_base from finance.exchange_rates
),
priced as (
  select
    p.id,
    p.user_id,
    p.amount,
    p.currency,
    coalesce(
      (select rate_to_base from rates where rates.user_id = p.user_id and rates.code = p.currency),
      1
    ) as rate_to_base
  from finance.payments p
  where p.net_amount_base is null
)
update finance.payments p
   set net_amount_base      = round((priced.amount * priced.rate_to_base)::numeric, 2),
       gross_at_market_base = round((priced.amount * priced.rate_to_base)::numeric, 2),
       implied_fee_base     = 0,
       fx_locked            = true
  from priced
 where p.id = priced.id;

-- Backfill payment_steps for every payment that doesn't already have a chain.
-- 1-step chain: same currency in/out, method NULL (user retro-tags as they go).
with base_currency as (
  select user_id, base_currency from finance.settings
)
insert into finance.payment_steps
  (payment_id, step_order, method_id, amount_in, currency_in, amount_out, currency_out, is_final)
select
  p.id,
  1,
  null::uuid,
  p.amount,
  p.currency,
  coalesce(p.net_amount_base, p.amount),
  coalesce((select base_currency from base_currency where base_currency.user_id = p.user_id), 'PHP'),
  true
from finance.payments p
where not exists (select 1 from finance.payment_steps s where s.payment_id = p.id);
