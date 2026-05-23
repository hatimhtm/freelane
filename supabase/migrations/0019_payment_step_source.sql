-- Freelane: make each payment hop an explicit FROM → TO transfer.
--
-- Until now a payment_step carried a single method_id ("the rail used"), so
-- expressing "Wise → coin.ph" meant two awkward steps. Now each step records
-- where the money came FROM and where it ended UP:
--
--   from_method_id  — the source (Wise, a Moroccan bank, PandaRemit…)
--   method_id       — the destination it landed on for this hop (coin.ph, GCash…)
--
-- A simple payment is one step: from Wise → to coin.ph. A chained one keeps
-- multiple steps where each hop's destination is the next hop's source.
--
-- method_id KEEPS its meaning as the hop's destination — which is also "where
-- the payment landed" for the holding-wallet balance (final step's method_id).
-- Existing rows get from_method_id = NULL (source unknown); they still render
-- fine (just the destination shows) and can be retro-tagged from the UI.

alter table finance.payment_steps
  add column if not exists from_method_id uuid references finance.payment_methods(id) on delete set null;

create index if not exists payment_steps_from_method_idx on finance.payment_steps (from_method_id);
