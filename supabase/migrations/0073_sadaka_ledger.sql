-- Freelane: Sadaka append-only ledger.
--
-- Single number — the sadaka pool — derived from five event kinds:
--   contribution   (+) every income event adds AI-decided fraction (anchored
--                      at 2.5% zakat) of net_amount_base
--   payment        (-) explicit "Mark sadaka given" CTA OR spend marked
--                      is_sadaka=true
--   auto_detected  (-) pattern-matched, person-flagged, or AI-classified
--                      spend; tentative=true for the AI-classifier branch
--   decay          (-) daily cron writes current_pool * (decay_pct_monthly/30)
--   adjustment     (signed) manual signed correction
--
-- pool_balance = SUM(amount_base) where archived_at is null. Display floor
-- is zero (the math can go slightly negative when decay overshoots a partial
-- contribution; the reader clamps in display).
--
-- The partial unique index enforces "one LIVE auto-detected/payment row per
-- spend" so the first matching auto-detection mechanism wins. Rejection via
-- "Not sadaka" sets archived_at, which releases the uniqueness slot — the
-- spend can be re-classified later without violating the constraint.

create table if not exists finance.sadaka_ledger (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  event_at     timestamptz not null default now(),
  kind         text not null check (kind in (
    'contribution',
    'payment',
    'auto_detected',
    'decay',
    'adjustment'
  )),
  amount_base  numeric(16, 2) not null,
  source_kind  text,
  source_id    uuid,
  rate_used    numeric,
  reasoning    text,
  tentative    boolean not null default false,
  archived_at  timestamptz,
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists sadaka_ledger_user_event_idx
  on finance.sadaka_ledger (user_id, event_at desc);

-- Partial unique: one LIVE auto_detected or payment row per (source_kind,
-- source_id) pair. Lets the rejection flow archive a row and re-classify
-- later without violating the constraint. Excludes rows with null source_id
-- (contributions / decay / adjustments aren't tied to a source mutation).
create unique index if not exists sadaka_ledger_source_live_uidx
  on finance.sadaka_ledger (user_id, source_kind, source_id)
  where source_id is not null and archived_at is null;

-- Note on source_id orphan behaviour:
--   sadaka_ledger.source_id is intentionally opaque — no FK to spends or
--   payments. The expected lifecycle is soft-delete via archived_at, so an
--   orphan happens only if a source row is hard-deleted (which the app
--   never does today). Hard deletion would leave a live sadaka_ledger row
--   pointing at a non-existent source; the reconciliation pass would
--   surface the drift but math stays consistent because the pool sum
--   only reads amount_base.
--
-- Note on amount_base precision:
--   The column stores numeric(16,2) at the DB so DECIMAL math survives a
--   SUM aggregate, but every read currently sums via JS Number()/reduce.
--   Safe at PHP magnitudes (under 2^53/100 cents), but if pool reads ever
--   become hot, push the SUM into a Postgres function returning numeric
--   so the rounding semantics travel with storage.

alter table finance.sadaka_ledger enable row level security;

create policy "sadaka_ledger_owner"
  on finance.sadaka_ledger
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
