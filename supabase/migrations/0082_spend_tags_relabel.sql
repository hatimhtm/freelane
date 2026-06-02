-- Freelane: spend tag splitting → pure labels (BUG FIX #1).
--
-- Current model (pre-0082) on finance.spend_category_links was
-- (spend_id, category_id) only — there was never an amount_share column
-- in the SEALED migrations 0050-0081. Discovery during the Spendings
-- workflow confirmed: tagging "ordering food" + "fast food" on the same
-- spend has NEVER allocated half the amount to each tag. The link table
-- has always been a pure many-to-many.
--
-- This migration is therefore a defensive no-op against the production
-- shape: it drops `amount_share` IF EXISTS so that any environment that
-- somehow added the column locally (an experimental branch, a manual
-- ALTER, etc.) is brought back to the canonical contract. On the live
-- schema the DROP is a silent no-op.
--
-- Why ship it anyway: the aggregation rules in src/lib/spends.ts +
-- src/components/spending/* are being rewritten to assume the column
-- cannot exist (Total Spent = SUM(distinct spend.amount_base), per-tag
-- total = SUM(spend.amount_base for tagged spends), and the sum of per-
-- tag totals CAN legitimately exceed Total Spent). Sealing the contract
-- in SQL means a future schema change can't silently reintroduce share-
-- based allocation without first being explicitly added back.

alter table finance.spend_category_links
  drop column if exists amount_share;

comment on table finance.spend_category_links is
  'Pure m2m label set (spend_id, category_id). Tags do NOT allocate the spend amount — each tagged spend counts FULL for every tag (overlapping totals across tags are honest, not a bug).';
