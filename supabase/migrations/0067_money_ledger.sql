-- Freelane: Unified Money Ledger.
--
-- THE load-bearing architectural piece for Phase 1.5 Dashboard. Every
-- wallet balance, dashboard metric, reconciliation pass, and forecast brain
-- derives from THIS table. Existing payments / spends / withdrawals /
-- sadaka / planned_spends remain authoritative for their domain (status,
-- allocations, project links, etc.) but the *money movement* is mirrored
-- here as a single signed-amount append-only log.
--
-- NOTE: the sign-vs-kind CHECK constraint that enforces
-- "income/adjustment/project_receipt amounts >= 0" and
-- "outflow/fee/sadaka_payment/unaccounted_outflow amounts <= 0" lives in
-- 0070 (money_ledger_kind_sign_chk). Between 0067 and 0070 the writer
-- module's "caller is responsible for sign" comment is enforced only at
-- the application layer; once 0070 applies the integrity invariant lands
-- in the database. The two migrations are intended to land together
-- pre-launch — narrative reads "table + CHECK in one breath".
--
-- WHY signed amount, not separate in/out columns:
--   - SUM(amount_base) on a wallet over a date range IS the running balance.
--   - one column collapses what was four maps in payment-chain.ts
--     (opening + received - withdrawn - spent) into one filter + sum.
--
-- WHY append-only + archived_at (soft delete):
--   - immutable past money is a Freelane invariant. Edits archive the old
--     ledger row and insert a fresh one — never UPDATE / DELETE.
--   - partial unique on (related_kind, related_id) WHERE archived_at IS NULL
--     enforces "one live ledger row per source mutation" while letting the
--     audit trail keep prior versions readable.
--
-- WHY kind ∈ {income, outflow, transfer, fee, sadaka_payment, project_receipt,
--             unaccounted_outflow, adjustment}:
--   income = a payment landed in a holding wallet (signed +).
--   outflow = a spend or withdrawal left a holding wallet (signed -).
--   transfer = a withdrawal that ALSO has a to_method_id (future v2 — for
--              now withdrawals just write one outflow on the from side).
--   fee = a per-step fee charged in transit (future — currently rolled into
--         the payment's net_amount_base).
--   sadaka_payment = the Sadaka workflow's outflows (separate, gated).
--   project_receipt = project-level receipt without a payment row (rare).
--   unaccounted_outflow = reconciliation gap row inserted by
--                         reconcile_user_wallets when ledger disagrees with
--                         the wallet's anchor.
--   adjustment = setWalletOpeningBalance writes one of these at the anchor
--                instant so the reader can see "the user said this was the
--                truth at T".

create table if not exists finance.money_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  event_at      timestamptz not null default now(),
  kind          text not null check (kind in (
    'income',
    'outflow',
    'transfer',
    'fee',
    'sadaka_payment',
    'project_receipt',
    'unaccounted_outflow',
    'adjustment'
  )),
  -- Signed: positive flows INTO the wallet, negative flows OUT.
  -- Wallet balance = opening_balance_base + SUM(amount_base) since anchor.
  amount_base   numeric(16, 2) not null,
  wallet_id     uuid references finance.payment_methods(id) on delete set null,
  related_kind  text check (related_kind in (
    'payment',
    'spend',
    'withdrawal',
    'sadaka',
    'project',
    'fee',
    'reconciliation'
  )),
  related_id    uuid,
  note          text,
  created_at    timestamptz not null default now(),
  archived_at   timestamptz
);

create index if not exists money_ledger_user_event_idx
  on finance.money_ledger (user_id, event_at desc);

create index if not exists money_ledger_user_wallet_event_idx
  on finance.money_ledger (user_id, wallet_id, event_at desc);

-- Partial unique: one LIVE row per source mutation. ON CONFLICT DO NOTHING
-- in the backfill (0068) keys off this index, and the writer-side
-- archive-then-insert flow upholds the same constraint at edit time.
create unique index if not exists money_ledger_related_live_uidx
  on finance.money_ledger (related_kind, related_id)
  where related_id is not null and archived_at is null;

alter table finance.money_ledger enable row level security;

create policy "money_ledger_owner"
  on finance.money_ledger
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
