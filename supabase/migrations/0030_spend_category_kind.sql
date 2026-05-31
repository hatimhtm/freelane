-- Freelane: Investment vs Consumption Ledger.
--
-- Hatim's mental model: "investments" are upgrades that pay back (laptop,
-- keyboard, dev subscriptions) — not stocks/bonds. The Investment seed
-- category catches the obvious cases, but a single tag isn't enough — the
-- ledger needs to know whether a category, as a class, leans toward
-- investment, consumption, or neither, so the dashboard can show the running
-- 30-day split without making the user re-classify every spend.
--
-- kind values:
--   consumption — money that leaves and doesn't return (groceries, fast food,
--                 cigarettes, rent, transportation, wifi/bills)
--   investment  — money that earns back more than itself over time (laptop,
--                 keyboard, dev tools, education, even Tech sometimes)
--   neutral     — neither clearly (loan repayments, sadaka, forgotten, other)
--
-- The spend kind is computed from the category tags it carries:
--   any investment tag  → spend rolls up as investment
--   else any consumption tag → consumption
--   else                → neutral
--
-- (Concrete logic lives in src/lib/spends.ts — this is just the input.)

create type finance.spend_category_kind as enum ('consumption', 'investment', 'neutral');

alter table finance.spend_categories
  add column if not exists kind finance.spend_category_kind not null default 'consumption';

-- Seed-row classification. Keep this list narrow — anything not listed stays
-- on the 'consumption' default, which the user can flip via Settings.
update finance.spend_categories
   set kind = 'investment'
 where lower(name) in ('investment', 'tech');

update finance.spend_categories
   set kind = 'neutral'
 where lower(name) in ('loan repayment', 'sadaka', 'forgotten', 'other');

create index if not exists spend_categories_kind_idx
  on finance.spend_categories (user_id, kind)
  where archived = false;
