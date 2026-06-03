-- Freelane: vendor backfill cursor.
--
-- The canonicalize-vendor backfill brain (api/cron/vendors-backfill)
-- iterates vendors needing identification, runs the Pro brain per row,
-- queues vendor_clarify notifications rate-limited to 5/day. This table
-- holds the per-user cursor + counters so the cron is idempotent and
-- resumable: a half-finished pass picks up where it left off the next
-- day.
--
-- finished_at flips when every vendor with needs_identification or
-- NULL canonical_name has been processed once. The row stays in place
-- afterwards so a future migration that re-opens identification can
-- re-use the same cursor by clearing finished_at.

create table if not exists finance.vendor_backfill_progress (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null unique
                       references auth.users(id) on delete cascade,
  cursor_vendor_id     uuid,
  vendors_processed    integer not null default 0,
  vendors_total        integer,
  started_at           timestamptz not null default now(),
  finished_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table finance.vendor_backfill_progress enable row level security;

create policy vendor_backfill_progress_owner_select on finance.vendor_backfill_progress
  for select using (user_id = auth.uid());
create policy vendor_backfill_progress_owner_insert on finance.vendor_backfill_progress
  for insert with check (user_id = auth.uid());
create policy vendor_backfill_progress_owner_update on finance.vendor_backfill_progress
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy vendor_backfill_progress_owner_delete on finance.vendor_backfill_progress
  for delete using (user_id = auth.uid());

comment on table finance.vendor_backfill_progress is
  'Per-user cursor for the canonicalize-vendor backfill cron. Tracks how far through the unidentified-vendor pool the brain has been; finished_at flips when the pass completes.';
