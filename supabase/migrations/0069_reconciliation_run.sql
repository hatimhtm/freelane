-- Freelane: reconciliation pass scaffold.
--
-- SEAM-ONLY STUB. 0070 immediately overwrites this function body with the
-- real expected-vs-actual implementation; this migration only exists to
-- give the daily cron a stable RPC name to call between the moment 0067
-- + 0068 apply and the moment 0070 lands. In any environment where all
-- four pre-launch migrations apply together (production), 0069 has no
-- runtime effect — 0070 supplies the actual gap-detection logic. Kept as
-- a separate migration so the historical narrative reads "stub seam →
-- real implementation" rather than "create with bug, no record of fix".
--
-- v1 was a stub. The KEY architectural deliverable from this workflow is
-- 0067 (the ledger) + 0068 (backfill). Reconciliation is the FUTURE half:
-- once Hatim re-anchors a wallet, the gap between the new opening and the
-- current ledger-derived balance becomes an "unaccounted_outflow" row.
--
-- BEHAVIOUR (per holding wallet w):
--   expected = m.opening_balance_base + SUM(amount_base) since anchor
--   actual   = m.opening_balance_base   (truth at anchor)
--   gap      = expected - actual
--   if gap < -p_threshold_base then insert one unaccounted_outflow row
--     (amount_base = gap, event_at = today_eod) and the next ledger read
--     will reconcile back to the truth side.
--
-- v1 NOTE: with no separate "truth source" yet (the user doesn't enter a
-- midday balance check), expected == actual + ledger movements by
-- definition. The body below detects no gaps unless future workflows add
-- a manual truth-check entry point. Function is wired regardless so the
-- cron + write path can mature without another migration.

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
  wallet_row record;
  ledger_sum numeric;
  gap_amount numeric;
begin
  for wallet_row in
    select id, opening_balance_base, opening_balance_set_at
      from finance.payment_methods
     where user_id = p_user_id
       and coalesce(is_holding, false) = true
  loop
    -- Ledger movements since the anchor instant (or all-time if no anchor).
    select coalesce(sum(amount_base), 0)
      into ledger_sum
      from finance.money_ledger
     where user_id = p_user_id
       and wallet_id = wallet_row.id
       and archived_at is null
       and (
         wallet_row.opening_balance_set_at is null
         or event_at >= wallet_row.opening_balance_set_at
       );

    -- v1: no separate truth source, so gap stays 0 until a future workflow
    -- supplies one. The branch is here so when that workflow lands the
    -- write path is already correct.
    gap_amount := 0;

    if gap_amount < -1 * p_threshold_base then
      insert into finance.money_ledger (
        user_id, event_at, kind, amount_base, wallet_id, related_kind, note
      ) values (
        p_user_id,
        (date_trunc('day', now()) + interval '23 hours 59 minutes'),
        'unaccounted_outflow',
        gap_amount,
        wallet_row.id,
        'reconciliation',
        'reconcile_user_wallets stub gap'
      );
    end if;
  end loop;
end;
$$;

grant execute on function finance.reconcile_user_wallets(uuid, numeric) to authenticated;
