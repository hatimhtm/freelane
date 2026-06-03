-- Freelane: denormalized outstanding loan counter on finance.entities so
-- the People list card can render a "Loan: open" badge without joining
-- against finance.loans on every render.
--
-- The trigger keeps the counter in sync with the loans table by
-- recomputing the count of (status in ('open', 'partial',
-- 'partially_returned')) per-entity on every loans insert / update /
-- delete. Forgiven, returned, and written-off loans drop out of the
-- count immediately.
--
-- Initial backfill is idempotent: if no loans exist, the SET clause
-- sets the cache to 0 for every entity (which it already is by
-- default).

alter table finance.entities
  add column if not exists outstanding_loan_count_cached integer not null default 0;

create or replace function finance.recompute_entity_loan_count(p_entity_id uuid)
returns void
language plpgsql
security definer
set search_path = public, finance
as $$
declare
  v_count integer;
begin
  if p_entity_id is null then
    return;
  end if;
  select count(*)::int into v_count
    from finance.loans
   where counterparty_entity_id = p_entity_id
     and status in ('open', 'partial', 'partially_returned');
  update finance.entities
     set outstanding_loan_count_cached = v_count
   where id = p_entity_id;
end;
$$;

create or replace function finance.tg_loans_entity_count_sync()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.counterparty_entity_id is not null then
      perform finance.recompute_entity_loan_count(new.counterparty_entity_id);
    end if;
  elsif tg_op = 'UPDATE' then
    -- Only recompute when something that affects the count actually changed:
    -- status moves a loan in/out of the open buckets, and entity reassignment
    -- moves the row across cache buckets. Notes-only / amount-only edits are
    -- skipped so the most common UPDATE path (status flip on forgive/return)
    -- still works while a pure metadata edit is free.
    if old.counterparty_entity_id is not null
       and (old.status is distinct from new.status
            or old.counterparty_entity_id is distinct from new.counterparty_entity_id) then
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

drop trigger if exists loans_entity_count_sync on finance.loans;

create trigger loans_entity_count_sync
  after insert or update or delete on finance.loans
  for each row execute function finance.tg_loans_entity_count_sync();

-- Backfill — recompute for every entity that already has a loan row.
-- Idempotent.
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
