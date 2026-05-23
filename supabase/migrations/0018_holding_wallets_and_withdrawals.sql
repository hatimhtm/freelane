-- Freelane: holding wallets + standalone withdrawals.
--
-- Some money doesn't arrive as final pesos in hand — it lands in a wallet I
-- keep a balance in (coin.ph, or physical Cash) and rests there. I count it as
-- landed income the moment it arrives (it's settled PHP, decoupled from the
-- project it came from), then later I move it out — and THAT move has its own
-- fee. Two changes ship together:
--
-- 1. payment_methods.is_holding — flags a method as a wallet that carries a
--    running balance (received into it − withdrawn out of it). coin.ph + Cash.
--    Non-holding methods (Wise, GCash, PandaRemit…) are pure rails/hops.
--
-- 2. finance.withdrawals — a standalone "I moved money out of a holding wallet"
--    log. NOT tied to a project (the money was liberated when it landed). Just:
--    which wallet, where it went, gross out, net received, and the fee that ate
--    the difference. The fee is the SAME fee statistic as a payment-chain fee —
--    it feeds the fee totals and reduces what counts as kept that month — it
--    just doesn't appear in the "cheapest ways to get paid" receive leaderboard.

-- ── 1. Holding flag ────────────────────────────────────────────────────
alter table finance.payment_methods
  add column if not exists is_holding boolean not null default false;

-- ── 2. Withdrawals ───────────────────────────────────────────────────────
-- All amounts in the base currency (PHP). coin.ph holds PHP, so gross/net are
-- already base; no FX snapshot needed. fee_base = gross_base − net_base.
create table if not exists finance.withdrawals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  -- The holding wallet the money came out of (coin.ph). Kept even if the method
  -- is later deleted, so the withdrawal still reads — label just goes "Untagged".
  from_method_id uuid references finance.payment_methods(id) on delete set null,
  -- Where the net landed (defaults to Cash). Optional.
  to_method_id   uuid references finance.payment_methods(id) on delete set null,
  withdrawn_at   date not null default current_date,
  gross_base     numeric(14, 2) not null check (gross_base >= 0),
  net_base       numeric(14, 2) not null check (net_base >= 0),
  fee_base       numeric(14, 2) not null default 0 check (fee_base >= 0),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists withdrawals_user_date_idx   on finance.withdrawals (user_id, withdrawn_at desc);
create index if not exists withdrawals_from_method_idx  on finance.withdrawals (from_method_id);

alter table finance.withdrawals enable row level security;

create policy "owner_all" on finance.withdrawals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create trigger withdrawals_touch
  before update on finance.withdrawals
  for each row execute function finance.touch_updated_at();

-- ── 3. Seed the new rails for every existing user ──────────────────────────
-- coin.ph + Cash are holding wallets; PandaRemit is the rail Chinese clients
-- use to send money into coin.ph (not a wallet of mine — fees only).
-- Idempotent on (user_id, name).
insert into finance.payment_methods (user_id, name, kind, is_holding, currency_in, currency_out, notes)
select s.user_id, m.name, m.kind::finance.payment_method_kind, m.is_holding, m.currency_in, m.currency_out, m.notes
from finance.settings s
cross join (values
  ('coin.ph',    'wallet', true,  null::text, 'PHP', 'Wallet I keep a PHP balance in. Money landed here counts as received; I withdraw to Cash later.'),
  ('Cash',       'cash',   true,  'PHP',      'PHP', 'Physical cash on hand. Some payments land 100% in cash.'),
  ('PandaRemit', 'other',  false, null::text, null::text, 'App my Chinese clients use to send money into coin.ph. Tracked so its fees count.')
) as m(name, kind, is_holding, currency_in, currency_out, notes)
on conflict (user_id, name) do nothing;

-- Flag any pre-existing coin.ph / Cash methods (created before this migration)
-- as holding, since the seed's ON CONFLICT skip won't update them.
update finance.payment_methods
   set is_holding = true
 where lower(name) in ('coin.ph', 'coinph', 'cash');
