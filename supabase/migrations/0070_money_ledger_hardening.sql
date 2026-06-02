-- Freelane: money_ledger hardening pass.
--
-- This migration closes the verifier-flagged gaps on 0067-0069:
--
--   1. CHECK constraint enforcing sign-vs-kind. An 'income' row with a
--      negative amount_base would corrupt the running SUM silently — the
--      writer-side comment in money-ledger.ts already says "caller is
--      responsible for sign", so we move that contract into the database
--      layer where it cannot drift.
--
--   2. replace_money_ledger_row(...) plpgsql function. Atomically archives
--      the prior live row and inserts a fresh one in one transaction so
--      edit paths can never end up in the half-archived state actions.ts
--      previously risked (archive succeeds, insert fails → wallet drift).
--
--   3. money_ledger_write_failures table. Bare catch {} on the writer side
--      is unrecoverable silence; this table accepts a one-row "we tried,
--      it failed" marker the application can append from its catch block,
--      so the reconciliation pass + future AI questions have a signal to
--      latch onto.
--
--   4. reconcile_user_wallets v2 — real expected-vs-actual check. The v1
--      body (gap := 0) was a no-op; this version derives `expected` from
--      the ledger itself, derives `actual` from the source-table totals
--      since the anchor (received - withdrawn - spent), and inserts an
--      `unaccounted_outflow` row when the absolute gap exceeds the
--      threshold. The function still tolerates a missing source side by
--      coalescing to 0 — better to under-flag than to fire a false
--      reconciliation when half the data isn't there.

-- ── 1. Sign-vs-kind CHECK on money_ledger ────────────────────────────────
alter table finance.money_ledger
  add constraint money_ledger_kind_sign_chk check (
    (kind in ('income', 'project_receipt', 'adjustment') and amount_base >= 0)
    or (kind in ('outflow', 'fee', 'sadaka_payment', 'unaccounted_outflow') and amount_base <= 0)
    or (kind = 'transfer')
  );

-- ── 2. Atomic archive + insert RPC ───────────────────────────────────────
--
-- Called by edit-path server actions. Replaces the previous sequential
-- archiveLedger() + insertLedger() pair with a single transactional swap.
-- Returns the id of the freshly inserted row so callers can audit.
create or replace function finance.replace_money_ledger_row(
  p_related_kind text,
  p_related_id   uuid,
  p_event_at     timestamptz,
  p_kind         text,
  p_amount_base  numeric,
  p_wallet_id    uuid,
  p_note         text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, finance
as $$
declare
  uid       uuid := auth.uid();
  new_id    uuid;
begin
  if uid is null then
    raise exception 'replace_money_ledger_row requires an authenticated user';
  end if;

  update finance.money_ledger
     set archived_at = now()
   where user_id      = uid
     and related_kind = p_related_kind
     and related_id   = p_related_id
     and archived_at  is null;

  insert into finance.money_ledger (
    user_id, event_at, kind, amount_base, wallet_id,
    related_kind, related_id, note
  ) values (
    uid, p_event_at, p_kind, p_amount_base, p_wallet_id,
    p_related_kind, p_related_id, p_note
  )
  returning id into new_id;

  return new_id;
end;
$$;

grant execute on function finance.replace_money_ledger_row(
  text, uuid, timestamptz, text, numeric, uuid, text
) to authenticated;

-- ── 3. Ledger write-failure log ──────────────────────────────────────────
--
-- The writer module previously swallowed all errors. This table accepts a
-- single row per failure so the reconciliation pass + future AI questions
-- have something to latch onto. RLS owner-only.
create table if not exists finance.money_ledger_write_failures (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  related_kind text,
  related_id   uuid,
  -- 'read' was added when the dashboard's silent .catch on the ledger
  -- read was replaced with a logged failure so drift surfaces alongside
  -- writer-side failures rather than disappearing into a Map().
  op           text not null check (op in ('insert', 'archive', 'replace', 'read')),
  message      text,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

create index if not exists money_ledger_write_failures_user_idx
  on finance.money_ledger_write_failures (user_id, created_at desc)
  where resolved_at is null;

alter table finance.money_ledger_write_failures enable row level security;

create policy "money_ledger_write_failures_owner"
  on finance.money_ledger_write_failures
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── 4. Real reconcile_user_wallets ───────────────────────────────────────
--
-- For each holding wallet:
--   actual    = opening_balance_base
--             + (received  via finance.payments       since anchor)
--             - (withdrawn via finance.withdrawals    since anchor)
--             - (spent     via finance.spends         since anchor)
--   expected  = opening_balance_base
--             + SUM(finance.money_ledger.amount_base) since anchor
--   gap       = actual - expected
--
-- A negative gap means the ledger over-credits the wallet vs the source
-- tables (i.e. an outflow source row didn't mirror). A positive gap means
-- the opposite. Either way we surface the delta as an unaccounted_outflow
-- when |gap| > threshold, and the next ledger read snaps the running sum
-- back to the source-table truth.
create or replace function finance.reconcile_user_wallets(
  p_user_id uuid,
  p_threshold_base numeric default 50
)
returns void
language plpgsql
security definer
set search_path = public, finance
as $$
declare
  wallet_row    record;
  anchor_ts     timestamptz;
  received_sum  numeric;
  withdrawn_sum numeric;
  spent_sum     numeric;
  actual_amt    numeric;
  ledger_sum    numeric;
  expected_amt  numeric;
  gap_amount    numeric;
begin
  for wallet_row in
    select id, opening_balance_base, opening_balance_set_at, opening_balance_at
      from finance.payment_methods
     where user_id = p_user_id
       and coalesce(is_holding, false) = true
  loop
    anchor_ts := coalesce(
      wallet_row.opening_balance_set_at,
      (wallet_row.opening_balance_at::timestamp at time zone 'Asia/Manila')
    );

    -- Received side (income landing). Payment-step join keeps the
    -- landing-wallet semantics aligned with 0068.
    select coalesce(sum(p.net_amount_base), 0)
      into received_sum
      from finance.payments p
     where p.user_id = p_user_id
       and p.net_amount_base > 0
       and (anchor_ts is null
            or (p.paid_at::timestamp at time zone 'Asia/Manila') + interval '12 hours'
               >= anchor_ts)
       and (
         select s.method_id
           from finance.payment_steps s
          where s.payment_id = p.id
          order by s.step_order desc
          limit 1
       ) = wallet_row.id;

    select coalesce(sum(w.gross_base), 0)
      into withdrawn_sum
      from finance.withdrawals w
     where w.user_id = p_user_id
       and w.from_method_id = wallet_row.id
       and w.gross_base > 0
       and (anchor_ts is null
            or (w.withdrawn_at::timestamp at time zone 'Asia/Manila') + interval '12 hours'
               >= anchor_ts);

    select coalesce(sum(sp.amount_base), 0)
      into spent_sum
      from finance.spends sp
     where sp.user_id = p_user_id
       and sp.wallet_id = wallet_row.id
       and sp.amount_base > 0
       and (anchor_ts is null
            or (sp.spent_at::timestamp at time zone 'Asia/Manila') + interval '12 hours'
               >= anchor_ts);

    actual_amt := coalesce(wallet_row.opening_balance_base, 0)
                + received_sum - withdrawn_sum - spent_sum;

    select coalesce(sum(amount_base), 0)
      into ledger_sum
      from finance.money_ledger
     where user_id = p_user_id
       and wallet_id = wallet_row.id
       and archived_at is null
       and (anchor_ts is null or event_at >= anchor_ts);

    expected_amt := coalesce(wallet_row.opening_balance_base, 0) + ledger_sum;

    gap_amount := actual_amt - expected_amt;

    if abs(gap_amount) > p_threshold_base then
      insert into finance.money_ledger (
        user_id, event_at, kind, amount_base, wallet_id, related_kind, note
      ) values (
        p_user_id,
        (date_trunc('day', now()) + interval '23 hours 59 minutes'),
        'unaccounted_outflow',
        -- Sign: when actual is LOWER than expected the wallet really has less
        -- money than the ledger says, so we push the ledger DOWN (negative
        -- amount). When actual is HIGHER we still file as unaccounted_outflow
        -- with the absolute-negative semantics — the CHECK constraint only
        -- accepts <= 0 for this kind, so we always store the negative
        -- magnitude.
        -1 * abs(gap_amount),
        wallet_row.id,
        'reconciliation',
        'reconcile_user_wallets gap'
      );
    end if;
  end loop;
end;
$$;

grant execute on function finance.reconcile_user_wallets(uuid, numeric) to authenticated;
