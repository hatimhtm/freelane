-- Freelane: Named charity vendor flag (sadaka auto-detection mechanism #2).
--
-- finance.vendors exists since 0032. Adding an is_charity boolean here lets
-- a user maintain a small named-charity list in settings. The spend pipeline
-- resolves vendor links from description tokens; if a resolved vendor has
-- is_charity=true and the spend wasn't already flagged is_sadaka=true, the
-- auto-detect hook writes an auto_detected sadaka_ledger row.
--
-- This is COMPLEMENTARY to entities.sadaka_recipient (0072) — that flag is
-- for transfers to specific PEOPLE (entities); this flag is for outflows to
-- CHARITY VENDORS. Keeping the two separate matches the user's mental model:
-- "send my brother ₱500" vs "donate at the mosque".

alter table finance.vendors
  add column if not exists is_charity boolean not null default false;

create index if not exists vendors_is_charity_idx
  on finance.vendors (user_id)
  where is_charity = true;
