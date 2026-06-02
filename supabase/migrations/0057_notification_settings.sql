-- Freelane Notifications — per-user retention + push + per-kind prefs.
--
-- Design intent: ONE canonical row per user (enforced by the UNIQUE on
-- user_id). The spec talks about "single-row insert" — the real invariant
-- is "single canonical row per user", which we satisfy WITHOUT seeding
-- here. Two reasons we deliberately skip seeding inside this migration:
--   1. Seeding from auth.users in a regular migration would require
--      service-role privilege at migrate-time; doing it inline couples
--      the auth schema to the finance schema in a way that breaks down
--      the moment a new user signs up after this migration runs.
--   2. RLS-correctness — the dispatcher's first-read path
--      (lib/notifications/dispatcher.ts, readNotificationSettings) upserts
--      the row using the user's own JWT, so the insert obeys RLS naturally
--      and survives sign-ups that happen long after deploy.
-- Existing users at deploy-time are backfilled by migration 0059. The
-- dispatcher's first-read upsert is the backstop for everyone else.
--
-- per_kind_prefs shape: { [kind]: { in_app?: bool, push?: bool, sound?: bool } }
-- Missing kind defaults to in_app=true, push=false, sound=false. This table
-- supersedes finance.notification_prefs going forward; the older table stays
-- for backward-compat reads in the dispatcher.

create table if not exists finance.notification_settings (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null unique references auth.users(id) on delete cascade,
  retention_days    int  not null default 3,
  retention_forever bool not null default false,
  push_enabled      bool not null default false,
  per_kind_prefs    jsonb not null default '{}'::jsonb,
  updated_at        timestamptz not null default now()
);

alter table finance.notification_settings enable row level security;

create policy "owner_all" on finance.notification_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
