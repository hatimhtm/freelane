-- Freelane: Loans workflow — bidirectional loans + partial returns + Sadaka
-- forgive conversion.
--
-- DESIGN NOTE — schema reconciliation with migration 0020:
--
-- Migration 0020 already shipped a finance.loans table with:
--   - direction finance.loan_direction enum ('borrowed' | 'lent')
--   - counterparty TEXT
--   - principal_amount, principal_currency, principal_base
--   - borrowed_at, expected_return_by, status enum, notes
--
-- The new loans workflow uses direction ('given' | 'received') and an
-- entity FK on counterparty. Semantic mapping is direct:
--   lent     ⇄ given     (I sent money out)
--   borrowed ⇄ received  (Money came in to me)
--
-- Rather than rename-and-replace (which would invalidate every legacy
-- read path including AI memory + curiosity sweep + safe-to-spend AI),
-- we ALTER in place:
--
--   1. Replace the loan_direction enum with a TEXT + CHECK that accepts
--      both legacy values AND the new ones. Existing rows keep their
--      'borrowed' / 'lent' direction unchanged; new code writes
--      'given' / 'received'.
--   2. Replace the loan_status enum with a TEXT + CHECK that supersets
--      the legacy ('open' | 'partial' | 'closed') with the new states
--      ('open' | 'partial' | 'closed' | 'partially_returned' |
--       'returned' | 'forgiven' | 'written_off'). Legacy rows untouched.
--   3. Add the new optional columns: counterparty_entity_id,
--      origin_wallet_id, origin_spend_id, due_date, is_for_someone_else,
--      currency (default 'PHP').
--   4. Add a non_loan boolean to spends so the rejection path can flag
--      a spend "already classified — don't re-propose".
--
-- Tables created: finance.loan_returns, finance.loan_forgivals.
-- loan_forgivals.sadaka_payment_id references finance.sadaka_ledger(id)
-- — the brief's "sadaka_payments" pointer translates to sadaka_ledger
-- (the table that actually exists; sadaka_payments is a kind, not a
-- table). The mirroring exception (the spend's outflow ledger already
-- debited the wallet) is preserved end-to-end via the actions layer.

-- ── 1. Drop the enum CHECKs by switching direction + status to TEXT ──

alter table finance.loans
  alter column direction type text
  using direction::text;

alter table finance.loans
  alter column status type text
  using status::text;

-- The enums themselves can stay (they may be referenced elsewhere, e.g.
-- the TypeScript catalog) — only the column types are converted. Add
-- bounded CHECK constraints on the TEXT columns to keep referential
-- safety.
alter table finance.loans
  drop constraint if exists loans_direction_check;
alter table finance.loans
  add constraint loans_direction_check
  check (direction in ('borrowed', 'lent', 'given', 'received'));

alter table finance.loans
  drop constraint if exists loans_status_check;
alter table finance.loans
  add constraint loans_status_check
  check (
    status in (
      'open',
      'partial',
      'closed',
      'partially_returned',
      'returned',
      'forgiven',
      'written_off'
    )
  );

-- ── 2. Add the new optional columns ───────────────────────────────────

alter table finance.loans
  add column if not exists counterparty_entity_id uuid
    references finance.entities(id) on delete set null;

alter table finance.loans
  add column if not exists origin_wallet_id uuid
    references finance.payment_methods(id) on delete set null;

alter table finance.loans
  add column if not exists origin_spend_id uuid
    references finance.spends(id) on delete set null;

alter table finance.loans
  add column if not exists due_date date;

alter table finance.loans
  add column if not exists is_for_someone_else boolean not null default false;

-- New code uses `currency` to mean the principal currency. Legacy code
-- continues to use `principal_currency`. The two stay aligned because
-- createLoan / createPersonalLoan write both. Default 'PHP' makes the
-- new path single-currency-safe without forcing every legacy row to
-- backfill.
alter table finance.loans
  add column if not exists currency text not null default 'PHP'
    references finance.currencies(code);

-- counterparty is the legacy TEXT field — relax NOT NULL so the new
-- workflow can write rows that ONLY carry counterparty_entity_id.
-- (For new-workflow rows the entity row carries the display name; the
-- text field becomes a denormalized fallback.) Legacy rows keep their
-- existing counterparty text intact.
alter table finance.loans
  alter column counterparty drop not null;

-- principal_amount + principal_currency carry legacy data; the new
-- workflow writes principal_base + currency. Relax NOT NULL so the new
-- path doesn't have to materialize legacy fields.
alter table finance.loans
  alter column principal_amount drop not null;
alter table finance.loans
  alter column principal_currency drop not null;

-- ── 3. Partial indexes covering the open + by-entity queries ──────────

create index if not exists loans_open_idx
  on finance.loans (user_id, due_date)
  where status in ('open', 'partial', 'partially_returned');

create index if not exists loans_by_entity_idx
  on finance.loans (user_id, counterparty_entity_id)
  where status != 'forgiven' and counterparty_entity_id is not null;

-- ── 4. finance.loan_returns — partial returns ─────────────────────────

create table if not exists finance.loan_returns (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  loan_id           uuid not null references finance.loans(id) on delete cascade,
  amount_base       numeric(14, 2) not null check (amount_base > 0),
  return_wallet_id  uuid references finance.payment_methods(id) on delete set null,
  returned_at       timestamptz not null default now(),
  notes             text,
  created_at        timestamptz not null default now()
);

create index if not exists loan_returns_loan_idx
  on finance.loan_returns (loan_id, returned_at desc);

alter table finance.loan_returns enable row level security;

create policy "owner_all" on finance.loan_returns
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 5. finance.loan_forgivals — Sadaka conversion audit trail ─────────

create table if not exists finance.loan_forgivals (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  loan_id             uuid not null references finance.loans(id) on delete cascade,
  -- sadaka_payment_id points at finance.sadaka_ledger(id). The brief's
  -- "sadaka_payments" pointer translates to sadaka_ledger because
  -- sadaka_payments is a row kind on that table, not a separate table.
  sadaka_payment_id   uuid references finance.sadaka_ledger(id) on delete set null,
  forgiven_at         timestamptz not null default now(),
  reason              text,
  created_at          timestamptz not null default now()
);

create index if not exists loan_forgivals_loan_idx
  on finance.loan_forgivals (loan_id);

alter table finance.loan_forgivals enable row level security;

create policy "owner_all" on finance.loan_forgivals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 6. spends.non_loan flag ───────────────────────────────────────────
-- The loan-proposal brain may ask "was this a loan?" after a beneficiary
-- spend. When the user says no, we stamp the spend so the brain doesn't
-- re-ask on the next sweep. Default false means legacy spends never
-- claim to have been classified.

alter table finance.spends
  add column if not exists non_loan boolean not null default false;
