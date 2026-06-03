-- Freelane: entity_pattern_baselines defensive CHECKs (verifier fix).
--
-- Migration 0099 shipped the table; the verifier flagged the absence of
-- non-negative CHECK constraints on the stddev columns. updateBaseline's
-- EWMA formula is safe today but a future refactor that swaps the sign
-- would write negative variance; the CHECK constraint catches that
-- before the row lands. Same defence-in-depth as
-- client_pattern_baselines should ideally get later — entity is the
-- first surface where the brief explicitly called for the guard.
--
-- IF NOT EXISTS guard on the constraint name keeps the migration
-- idempotent on re-runs in dev.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'entity_pattern_baselines_stddev_nonneg'
  ) then
    alter table finance.entity_pattern_baselines
      add constraint entity_pattern_baselines_stddev_nonneg
      check (
        (transfer_cadence_stddev is null or transfer_cadence_stddev >= 0) and
        (transfer_amount_stddev is null or transfer_amount_stddev >= 0)
      );
  end if;
end$$;

comment on constraint entity_pattern_baselines_stddev_nonneg
  on finance.entity_pattern_baselines is
  'Stddev columns are always non-negative. Catches an EWMA sign-flip refactor before it lands a negative variance row.';
