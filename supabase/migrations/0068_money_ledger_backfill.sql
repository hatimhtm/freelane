-- Freelane: backfill money_ledger from existing payments / spends /
-- withdrawals. Idempotent — re-runnable safely. Uses `WHERE NOT EXISTS`
-- guards (against the partial unique on related_kind+related_id where
-- archived_at IS NULL) rather than ON CONFLICT, because PostgreSQL's
-- conflict-target inference for partial indexes requires the exact same
-- predicate at the call site and the column-quoted form is finicky.
--
-- WHY this exists: 0067 just created the table. The wallet balance reader
-- (src/lib/data/wallet-balance.ts) keys off the ledger. Without this
-- backfill, every existing user's dashboard would show ₱0 across all
-- wallets the moment the new reader ships. This populates one ledger row
-- per historical money movement so the new reader has truth to read.
--
-- COVERAGE:
--   - payments with net_amount_base > 0 → kind='income', wallet=landing
--   - spends with amount_base > 0       → kind='outflow', wallet=spend.wallet_id
--   - withdrawals with gross_base > 0   → kind='outflow', wallet=from_method_id
--   - sadaka rows: SKIPPED here — when the sadaka workflow lands it owns
--     the trigger-side insert and its own backfill.
--
-- TZ NOTE: payments.paid_at, spends.spent_at, and withdrawals.withdrawn_at
-- are DATE columns. A direct `::timestamptz` cast assumes UTC midnight,
-- which for PHT (UTC+8) shifts the event to 16:00 the previous PHT day —
-- in the worst case excluding the row from the post-anchor read window.
-- The reader (wallet-balance.ts) compares anchor timestamps in PHT, so we
-- backfill `event_at` as PHT noon (date → PHT-midnight + 12h), keeping
-- the row inside the anchor's PHT day regardless of the anchor's own
-- intra-day timestamp.
--
-- KNOWN GAPS:
--   - landing wallet for a payment = MAX(step_order) row's method_id.
--     Payments with zero steps (legacy, unusual) won't backfill — they
--     have no wallet to land on. The skipped set is captured in
--     money_ledger_backfill_skipped (created here) so a future reviewer
--     can decide whether to materialise a manual landing.
--   - withdrawals only write the outflow side (from_method_id). The
--     to_method_id side is a future "transfer" kind enhancement.

-- ── Income rows from payments ────────────────────────────────────────────
insert into finance.money_ledger (
  user_id, event_at, kind, amount_base, wallet_id, related_kind, related_id, note
)
select
  p.user_id,
  ((p.paid_at::timestamp) at time zone 'Asia/Manila') + interval '12 hours',
  'income',
  p.net_amount_base,
  (
    select s.method_id
      from finance.payment_steps s
     where s.payment_id = p.id
     order by s.step_order desc
     limit 1
  ),
  'payment',
  p.id,
  'backfill 0068'
  from finance.payments p
 where p.net_amount_base is not null
   and p.net_amount_base > 0
   and exists (
     select 1 from finance.payment_steps s where s.payment_id = p.id
   )
   and not exists (
     select 1 from finance.money_ledger l
      where l.related_kind = 'payment'
        and l.related_id = p.id
        and l.archived_at is null
   );

-- ── Outflow rows from spends ─────────────────────────────────────────────
insert into finance.money_ledger (
  user_id, event_at, kind, amount_base, wallet_id, related_kind, related_id, note
)
select
  sp.user_id,
  ((sp.spent_at::timestamp) at time zone 'Asia/Manila') + interval '12 hours',
  'outflow',
  -1 * sp.amount_base,
  sp.wallet_id,
  'spend',
  sp.id,
  'backfill 0068'
  from finance.spends sp
 where sp.amount_base is not null
   and sp.amount_base > 0
   and not exists (
     select 1 from finance.money_ledger l
      where l.related_kind = 'spend'
        and l.related_id = sp.id
        and l.archived_at is null
   );

-- ── Outflow rows from withdrawals ────────────────────────────────────────
insert into finance.money_ledger (
  user_id, event_at, kind, amount_base, wallet_id, related_kind, related_id, note
)
select
  w.user_id,
  ((w.withdrawn_at::timestamp) at time zone 'Asia/Manila') + interval '12 hours',
  'outflow',
  -1 * w.gross_base,
  w.from_method_id,
  'withdrawal',
  w.id,
  'backfill 0068'
  from finance.withdrawals w
 where w.gross_base is not null
   and w.gross_base > 0
   and w.from_method_id is not null
   and not exists (
     select 1 from finance.money_ledger l
      where l.related_kind = 'withdrawal'
        and l.related_id = w.id
        and l.archived_at is null
   );

-- ── Skipped-payment audit ────────────────────────────────────────────────
--
-- Capture every payment that COULD have backfilled but couldn't (zero
-- steps, missing landing wallet). The reconciliation review picks these
-- up so a future workflow can either materialise a manual landing or
-- explicitly mark them as out-of-scope. Idempotent — re-running this
-- migration re-populates the same set without duplicating notice rows.
create table if not exists finance.money_ledger_backfill_skipped (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  related_kind text not null,
  related_id   uuid not null,
  reason       text not null,
  noted_at     timestamptz not null default now(),
  unique (related_kind, related_id)
);

alter table finance.money_ledger_backfill_skipped enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'finance'
       and tablename = 'money_ledger_backfill_skipped'
       and policyname = 'owner_all'
  ) then
    execute $pol$
      create policy "owner_all" on finance.money_ledger_backfill_skipped
        for all using (auth.uid() = user_id) with check (auth.uid() = user_id)
    $pol$;
  end if;
end $$;

insert into finance.money_ledger_backfill_skipped (
  user_id, related_kind, related_id, reason
)
select
  p.user_id,
  'payment',
  p.id,
  'no payment_steps row — no landing wallet to mirror'
  from finance.payments p
 where p.net_amount_base is not null
   and p.net_amount_base > 0
   and not exists (
     select 1 from finance.payment_steps s where s.payment_id = p.id
   )
on conflict (related_kind, related_id) do nothing;
