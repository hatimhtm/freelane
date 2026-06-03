-- Freelane Loans — verifier follow-ups for 0106 / 0107 / 0111.
--
-- Four changes, each addressing a concrete verifier finding:
--
--   1. finance.record_loan_return RPC — mirrors the forgive_loan pattern.
--      Locks the loans row FOR UPDATE, recomputes sum(loan_returns) inside
--      the same transaction, inserts the new return row, flips
--      loans.status atomically. Closes the SELECT-then-INSERT race in
--      recordLoanReturn (two concurrent submissions could both pass the
--      over-return guard before either insert landed).
--
--   2. loans_by_entity_idx tightened. The 0106 predicate excluded only
--      status='forgiven', leaving 'returned' and 'written_off' inside
--      the index. The intent is open-loans-by-entity lookups — match the
--      same status set the trigger uses ('open', 'partial',
--      'partially_returned').
--
--   3. loan_returns.return_wallet_id NOT NULL. The action requires it
--      (recordLoanReturn throws when empty); document that invariant at
--      the schema level so direct SQL writes / future migrations can't
--      drift. No legacy rows exist that violate this — 0106 introduced
--      the table.
--
--   4. loan_returns idempotency — optional client_request_id with a
--      partial unique index. Resubmitting a return (double-click, retry,
--      optimistic UI replay) no longer inserts a duplicate row when the
--      caller passes the same request id.
--
--   5. tg_loans_entity_count_sync search_path hardening. The 0107 helper
--      function set search_path explicitly; the trigger function did not.
--      Belt-and-suspenders against any future migration changing the
--      session default.

-- ── 1. Tighten loans_by_entity_idx ────────────────────────────────────

drop index if exists finance.loans_by_entity_idx;

create index if not exists loans_by_entity_idx
  on finance.loans (user_id, counterparty_entity_id)
  where status in ('open', 'partial', 'partially_returned')
    and counterparty_entity_id is not null;

-- ── 2. loan_returns.return_wallet_id NOT NULL ─────────────────────────
-- No rows in production carry a null wallet (the action throws on null).
-- The 0106 column was nullable purely from oversight.

alter table finance.loan_returns
  alter column return_wallet_id set not null;

-- ── 3. loan_returns idempotency key ───────────────────────────────────

alter table finance.loan_returns
  add column if not exists client_request_id text;

create unique index if not exists loan_returns_client_request_uniq
  on finance.loan_returns (user_id, loan_id, client_request_id)
  where client_request_id is not null;

-- ── 4. Trigger search_path hardening ──────────────────────────────────

create or replace function finance.tg_loans_entity_count_sync()
returns trigger
language plpgsql
set search_path = public, finance
as $$
begin
  if tg_op = 'INSERT' then
    if new.counterparty_entity_id is not null then
      perform finance.recompute_entity_loan_count(new.counterparty_entity_id);
    end if;
  elsif tg_op = 'UPDATE' then
    if old.counterparty_entity_id is not null then
      perform finance.recompute_entity_loan_count(old.counterparty_entity_id);
    end if;
    if new.counterparty_entity_id is not null
       and new.counterparty_entity_id is distinct from old.counterparty_entity_id then
      perform finance.recompute_entity_loan_count(new.counterparty_entity_id);
    end if;
  elsif tg_op = 'DELETE' then
    if old.counterparty_entity_id is not null then
      perform finance.recompute_entity_loan_count(old.counterparty_entity_id);
    end if;
  end if;
  return null;
end;
$$;

create or replace function finance.tg_loan_returns_entity_sync()
returns trigger
language plpgsql
set search_path = public, finance
as $$
declare
  v_loan_entity uuid;
begin
  if tg_op = 'DELETE' then
    select counterparty_entity_id into v_loan_entity
      from finance.loans where id = old.loan_id;
    if v_loan_entity is not null then
      perform finance.recompute_entity_loan_count(v_loan_entity);
    end if;
  else
    select counterparty_entity_id into v_loan_entity
      from finance.loans where id = new.loan_id;
    if v_loan_entity is not null then
      perform finance.recompute_entity_loan_count(v_loan_entity);
    end if;
  end if;
  return null;
end;
$$;

-- ── 5. record_loan_return RPC ─────────────────────────────────────────
-- Steps (all in one statement, all rolled back on any failure):
--   a. SELECT the loans row FOR UPDATE — serialises against concurrent
--      returns on the same loan.
--   b. Verify loan exists, belongs to caller, is not closed.
--   c. SUM existing loan_returns inside the same transaction.
--   d. Reject when (prior + new) > principal + epsilon (over-return).
--   e. If caller passed a client_request_id and a matching return already
--      exists, return that row (idempotent — no second insert).
--   f. INSERT the loan_returns row.
--   g. UPDATE loans.status to 'returned' / 'partially_returned' based on
--      the recomputed total.
--   h. Return (id, status). The wallet-mirror money_ledger write stays
--      in application code (best-effort, reconciliation converges).
--
-- SECURITY INVOKER so RLS keeps each user scoped to their own rows; the
-- function explicitly checks user_id = auth.uid() for an audit-friendly
-- error path even though RLS would already block.

create or replace function finance.record_loan_return(
  p_loan_id            uuid,
  p_amount_base        numeric,
  p_return_wallet_id   uuid,
  p_notes              text default null,
  p_client_request_id  text default null
)
returns table (
  id                   uuid,
  status               text,
  loan_id              uuid,
  direction            text,
  return_wallet_id     uuid,
  amount_base          numeric,
  total_returned_base  numeric
)
language plpgsql
security invoker
set search_path = public, finance
as $$
declare
  v_user_id        uuid;
  v_status         text;
  v_direction      text;
  v_principal      numeric;
  v_returned       numeric;
  v_next_status    text;
  v_amount         numeric;
  v_new_id         uuid;
  v_existing_id    uuid;
  v_existing_status text;
begin
  if p_amount_base is null or p_amount_base <= 0 then
    raise exception 'Return amount must be greater than 0.';
  end if;
  if p_return_wallet_id is null then
    raise exception 'Pick the wallet the return lands in.';
  end if;

  v_amount := round(p_amount_base::numeric, 2);

  -- Lock the loan row for the duration of this transaction so a sibling
  -- record_loan_return on the same loan blocks until we commit. This is
  -- what closes the over-return race that lived in the SELECT-then-INSERT
  -- shape.
  select user_id, status, direction, principal_base
    into v_user_id, v_status, v_direction, v_principal
    from finance.loans
   where id = p_loan_id
   for update;

  if v_user_id is null then
    raise exception 'Loan not found.';
  end if;
  if v_user_id <> auth.uid() then
    raise exception 'Loan not found.';
  end if;
  if v_status = 'forgiven' or v_status = 'written_off' then
    raise exception 'This loan is closed.';
  end if;
  if v_direction not in ('given', 'lent', 'received', 'borrowed') then
    raise exception 'Unknown loan direction.';
  end if;

  -- Idempotency — a retry of the same submission returns the existing
  -- row instead of inserting a duplicate.
  if p_client_request_id is not null then
    select r.id into v_existing_id
      from finance.loan_returns r
     where r.user_id = v_user_id
       and r.loan_id = p_loan_id
       and r.client_request_id = p_client_request_id
     limit 1;
    if v_existing_id is not null then
      select l.status into v_existing_status
        from finance.loans l
       where l.id = p_loan_id;
      return query
        select
          v_existing_id,
          v_existing_status,
          p_loan_id,
          v_direction,
          p_return_wallet_id,
          v_amount,
          coalesce((
            select sum(amount_base) from finance.loan_returns
             where loan_id = p_loan_id
          ), 0)::numeric;
      return;
    end if;
  end if;

  select coalesce(sum(amount_base), 0)
    into v_returned
    from finance.loan_returns
   where loan_id = p_loan_id;

  if v_returned + v_amount > v_principal + 0.001 then
    raise exception 'Return exceeds outstanding balance (% left).',
      to_char(greatest(0, v_principal - v_returned), 'FM999999990.00');
  end if;

  insert into finance.loan_returns (
    user_id,
    loan_id,
    amount_base,
    return_wallet_id,
    returned_at,
    notes,
    client_request_id
  ) values (
    v_user_id,
    p_loan_id,
    v_amount,
    p_return_wallet_id,
    now(),
    p_notes,
    p_client_request_id
  )
  returning loan_returns.id into v_new_id;

  v_returned := v_returned + v_amount;
  if v_returned + 0.001 >= v_principal then
    v_next_status := 'returned';
  elsif v_returned > 0 then
    v_next_status := 'partially_returned';
  else
    v_next_status := v_status;
  end if;

  if v_next_status <> v_status then
    update finance.loans
       set status = v_next_status
     where id = p_loan_id;
  end if;

  return query
    select
      v_new_id,
      v_next_status,
      p_loan_id,
      v_direction,
      p_return_wallet_id,
      v_amount,
      v_returned;
end;
$$;

grant execute on function finance.record_loan_return(uuid, numeric, uuid, text, text) to authenticated;
