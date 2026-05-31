-- Freelane: one payment can cover multiple projects.
--
-- Until now finance.payments.project_id was a single FK — a client paying for
-- three projects in one wire forced you to either fudge the entry or split it
-- across three payment rows (which broke the chain-fee math because the rails
-- were charged once, not three times).
--
-- New model: finance.payment_project_allocations carries the per-project share
-- of each payment. The fee gets split pro-rata by allocation_base across all
-- linked projects (the routing cost is the same regardless of how many projects
-- shared the wire).
--
-- payments.project_id is KEPT as a denormalized "primary project" pointer for
-- legacy queries and UI shorthand on single-project payments. The allocations
-- table is the source of truth — recomputeProjectStatus reads from it.

-- ── 1. Allocations table ─────────────────────────────────────────────────
-- allocation_base = the PHP share this project gets of the payment's net.
-- For a single-project payment, allocation_base == payments.net_amount_base.
-- For a 3-project ₱50k-net split 30/15/5, allocations are 30k / 15k / 5k.
-- allocation_amount / currency are the SAME-currency share of payments.amount
-- (what the client owed in CNY/USD/etc.) — usually you'd split in the project's
-- native currency, then convert each share to PHP via the chain math.
create table if not exists finance.payment_project_allocations (
  payment_id        uuid not null references finance.payments(id) on delete cascade,
  project_id        uuid not null references finance.projects(id) on delete cascade,
  allocation_amount numeric(14, 2) not null check (allocation_amount > 0),
  -- Currency the allocation is denominated in. Usually the project's currency.
  allocation_currency text not null references finance.currencies(code),
  -- PHP-equivalent share of the payment, locked at payment-entry time
  -- (mirrors payments.net_amount_base — never re-floats with market FX).
  allocation_base   numeric(14, 2) not null check (allocation_base >= 0),
  notes             text,
  created_at        timestamptz not null default now(),
  primary key (payment_id, project_id)
);

create index if not exists payment_project_alloc_project_idx
  on finance.payment_project_allocations (project_id);

alter table finance.payment_project_allocations enable row level security;

-- RLS via parent payment ownership (same pattern as payment_steps).
create policy "owner_via_payment" on finance.payment_project_allocations
  for all
  using (exists (select 1 from finance.payments p where p.id = payment_id and p.user_id = auth.uid()))
  with check (exists (select 1 from finance.payments p where p.id = payment_id and p.user_id = auth.uid()));

-- ── 2. Backfill existing payments as 1-allocation chains ─────────────────
-- Every existing payment becomes a single allocation row mirroring its
-- (project_id, amount, currency, net_amount_base). After backfill, the
-- allocations table is fully consistent with the legacy single-project model;
-- multi-project payments going forward will write 2+ allocation rows.
insert into finance.payment_project_allocations
  (payment_id, project_id, allocation_amount, allocation_currency, allocation_base)
select
  p.id,
  p.project_id,
  p.amount,
  p.currency,
  coalesce(p.net_amount_base, 0)
from finance.payments p
where not exists (
  select 1 from finance.payment_project_allocations a where a.payment_id = p.id
);

-- ── 3. View: per-project paid totals from allocations ────────────────────
-- Replaces the in-line aggregate in finance.project_totals — that one summed
-- payments.amount filtered to same-currency, which doesn't generalize. This
-- view sums allocations (always in project currency by convention).
create or replace view finance.project_paid_from_allocations as
select
  pp.project_id,
  pr.user_id,
  sum(pp.allocation_amount)        as paid_native,
  sum(pp.allocation_base)          as paid_base,
  count(distinct pp.payment_id)    as payment_count
from finance.payment_project_allocations pp
join finance.projects pr on pr.id = pp.project_id
group by pp.project_id, pr.user_id;

-- ── 4. Note on payments.project_id ───────────────────────────────────────
-- LEFT as NOT NULL for now. On insert of a multi-project payment, the server
-- action picks the largest allocation's project_id as the denormalized
-- "primary project" hint (used by the Payments list to show the headline
-- project name + a "+2 more" badge). Allocations remain the source of truth
-- for status recomputation and totals.
--
-- If we ever want true project-less payments (e.g. a refund), we'd need a
-- separate migration to make project_id nullable. Out of scope for v1.
