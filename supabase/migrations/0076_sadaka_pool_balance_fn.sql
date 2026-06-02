-- Freelane Sadaka — DB-side pool balance aggregate.
--
-- Pushes the SUM(amount_base) over live rows into Postgres so dashboard /
-- today / sadaka tab reads aren't pulling every event row into the app
-- server and reducing in JS. For a long-running user the row count grows
-- monotonically (one decay row per day + one contribution per income +
-- payments + auto_detected) — after a year, that's 4-figure row counts
-- pulled across three surfaces per navigation. This RPC returns a single
-- numeric scalar so the network + memory hit stops scaling with history.
--
-- Returns the raw signed sum (numeric, 2dp). Callers floor at zero for
-- the display layer (see lib/sadaka/ledger.ts:readPoolBalance). RLS is
-- handled inside the function via auth.uid() — security definer with a
-- locked search_path so a malicious extension can't redirect the table
-- name.

create or replace function finance.sadaka_pool_raw_base(p_user_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public, finance
as $$
declare
  v_total numeric;
begin
  -- Hard gate: a caller can only ask about themselves. The check matches
  -- the RLS policy on sadaka_ledger so any service-client caller must
  -- pass their own user_id explicitly.
  if p_user_id is null then
    return 0;
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  select coalesce(sum(amount_base), 0)
    into v_total
    from finance.sadaka_ledger
   where user_id = p_user_id
     and archived_at is null;

  return coalesce(v_total, 0);
end;
$$;

grant execute on function finance.sadaka_pool_raw_base(uuid) to authenticated;
grant execute on function finance.sadaka_pool_raw_base(uuid) to service_role;
