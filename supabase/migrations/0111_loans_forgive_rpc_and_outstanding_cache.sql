-- Freelane Loans — verifier follow-ups for 0106 / 0107.
--
-- Two changes:
--
--   1. finance.forgive_loan(p_loan_id, p_reason) — transactional RPC that
--      writes the sadaka_ledger payment row + loan_forgivals audit row +
--      flips loans.status='forgiven' in ONE statement so a failure on
--      step 2 or 3 rolls back the sadaka row. The application-layer
--      forgiveLoan in lib/loans/actions.ts now delegates to this RPC.
--
--      The function is SECURITY INVOKER so RLS keeps each user scoped to
--      their own rows. The function checks the loan belongs to auth.uid()
--      and returns NULL when the loan is already forgiven (caller looks
--      up the original sadaka_payment_id via the audit row).
--
--   2. finance.entities.outstanding_loan_base_cached — sibling to the
--      existing outstanding_loan_count_cached column (0107). Stores the
--      sum of (principal − returns) for OPEN loans on this entity so the
--      People list card can render "Loan: ₱X open" without joining
--      loans + loan_returns on every render. recompute_entity_loan_count
--      is widened to populate both columns; the trigger from 0107 keeps
--      firing on loans changes, and a NEW trigger on loan_returns picks
--      up partial-return events that shift only the outstanding sum.

-- ── 1. outstanding_loan_base_cached ───────────────────────────────────

alter table finance.entities
  add column if not exists outstanding_loan_base_cached numeric(14, 2)
  not null default 0;

create or replace function finance.recompute_entity_loan_count(p_entity_id uuid)
returns void
language plpgsql
security definer
set search_path = public, finance
as $$
declare
  v_count integer;
  v_base  numeric(14, 2);
begin
  if p_entity_id is null then
    return;
  end if;
  select
      count(*)::int,
      coalesce(sum(
        greatest(
          0,
          l.principal_base - coalesce((
            select sum(r.amount_base)
              from finance.loan_returns r
             where r.loan_id = l.id
          ), 0)
        )
      ), 0)::numeric(14, 2)
    into v_count, v_base
    from finance.loans l
   where l.counterparty_entity_id = p_entity_id
     and l.status in ('open', 'partial', 'partially_returned');
  update finance.entities
     set outstanding_loan_count_cached = v_count,
         outstanding_loan_base_cached = v_base
   where id = p_entity_id;
end;
$$;

-- Loan-returns sync: a partial return shifts the outstanding sum without
-- flipping the loan's status. Mirror the loans trigger so the cache stays
-- in step on every return write/update/delete.
create or replace function finance.tg_loan_returns_entity_sync()
returns trigger
language plpgsql
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

drop trigger if exists loan_returns_entity_sync on finance.loan_returns;

create trigger loan_returns_entity_sync
  after insert or update or delete on finance.loan_returns
  for each row execute function finance.tg_loan_returns_entity_sync();

-- Backfill — recompute base for every entity that already has a loan row.
do $$
declare
  rec record;
begin
  for rec in
    select distinct counterparty_entity_id as eid
      from finance.loans
     where counterparty_entity_id is not null
  loop
    perform finance.recompute_entity_loan_count(rec.eid);
  end loop;
end$$;

-- ── 2. forgive_loan RPC — transactional 3-row write ────────────────────
-- Steps (all in one statement, all rolled back on any failure):
--   a. Compute remaining outstanding = principal − sum(returns)
--   b. Insert sadaka_ledger payment row (negative amount_base)
--   c. Insert loan_forgivals audit row pointing at sadaka_payment_id
--   d. Update loans.status='forgiven'
--
-- Returns sadaka_payment_id (null when outstanding == 0; no contribution
-- to write but the loan still flips to forgiven). Throws on a non-given
-- loan, on a written-off loan, or on a non-existent loan.
--
-- Idempotency: when the loan is already forgiven the function returns
-- the existing loan_forgivals.sadaka_payment_id so the UI can relink to
-- the original contribution. The sadaka unique index
-- (user_id, source_kind, source_id) where archived_at is null already
-- prevents a second insertion on retry, but the explicit early-return
-- here removes the round-trip.

create or replace function finance.forgive_loan(
  p_loan_id uuid,
  p_reason text default null
)
returns table (
  loan_id uuid,
  sadaka_payment_id uuid,
  amount_base numeric
)
language plpgsql
security invoker
set search_path = public, finance
as $$
declare
  v_user_id uuid;
  v_status text;
  v_direction text;
  v_principal numeric;
  v_returned numeric;
  v_remaining numeric;
  v_sadaka_id uuid;
  v_existing_sadaka_id uuid;
begin
  select user_id, status, direction, principal_base
    into v_user_id, v_status, v_direction, v_principal
    from finance.loans
   where id = p_loan_id;

  if v_user_id is null then
    raise exception 'Loan not found.';
  end if;
  if v_user_id <> auth.uid() then
    -- RLS would already block the SELECT above but be explicit.
    raise exception 'Loan not found.';
  end if;
  if v_status = 'written_off' then
    raise exception 'Loan is already written off.';
  end if;
  if v_direction not in ('given', 'lent') then
    raise exception 'Only given loans can be forgiven into Sadaka.';
  end if;

  if v_status = 'forgiven' then
    -- Idempotent — surface the original audit row's sadaka_payment_id.
    select f.sadaka_payment_id
      into v_existing_sadaka_id
      from finance.loan_forgivals f
     where f.loan_id = p_loan_id
     order by f.forgiven_at desc
     limit 1;
    return query select p_loan_id, v_existing_sadaka_id, 0::numeric;
    return;
  end if;

  select coalesce(sum(amount_base), 0)
    into v_returned
    from finance.loan_returns
   where loan_id = p_loan_id;

  v_remaining := greatest(0, round((v_principal - v_returned)::numeric, 2));

  if v_remaining > 0 then
    insert into finance.sadaka_ledger (
      user_id,
      event_at,
      kind,
      amount_base,
      source_kind,
      source_id,
      reasoning
    ) values (
      v_user_id,
      now(),
      'payment',
      -1 * v_remaining,
      'loan_forgiven',
      p_loan_id,
      coalesce(p_reason, 'Loan forgiven — converted to sadaka.')
    )
    returning id into v_sadaka_id;
  end if;

  insert into finance.loan_forgivals (
    user_id,
    loan_id,
    sadaka_payment_id,
    forgiven_at,
    reason
  ) values (
    v_user_id,
    p_loan_id,
    v_sadaka_id,
    now(),
    p_reason
  );

  update finance.loans
     set status = 'forgiven'
   where id = p_loan_id;

  return query select p_loan_id, v_sadaka_id, v_remaining;
end;
$$;

grant execute on function finance.forgive_loan(uuid, text) to authenticated;
