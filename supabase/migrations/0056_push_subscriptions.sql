-- Freelane Notifications — Web Push subscriptions.
--
-- One row per device/browser the user has opted into push for. The endpoint
-- is the canonical unique identifier (the Push API URL the browser hands
-- back from pushManager.subscribe). p256dh + auth are the keys used to
-- encrypt the payload before web-push sends it.
--
-- 404/410 responses from the push service mean the endpoint is dead; the
-- server-side sender (src/lib/push/server.ts) prunes those automatically.
-- last_used_at is bumped on each successful send so stale rows are
-- distinguishable from never-used ones during future cleanup passes.

create table if not exists finance.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create index if not exists push_subs_user_idx
  on finance.push_subscriptions (user_id);

alter table finance.push_subscriptions enable row level security;

create policy "owner_all" on finance.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
