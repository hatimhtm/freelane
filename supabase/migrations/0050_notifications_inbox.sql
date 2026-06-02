-- Freelane: notification inbox + per-recipient prefs.
--
-- Foundation for System 1 (Bell + /notifications + dispatcher). One row per
-- notification dispatched to the single user. Tuesday check-in is the first
-- kind funneled through this — many more (plan-due, wallet-anchor-stale,
-- ai-question, year-recall) will follow without any new tables.
--
-- dedup_key is silent-no-op on collision (partial unique index, NULL allowed):
-- a brain that re-fires the same prompt twice in a day will only ever surface
-- one row to the bell. priority sorts heavy alerts (>=2 paints rose).

create table if not exists finance.notifications_inbox (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null,
  subject       text not null,
  body          text,
  link_url      text,
  dedup_key     text,
  priority      smallint not null default 0,
  read_at       timestamptz,
  dismissed_at  timestamptz,
  created_at    timestamptz not null default now()
);

create unique index if not exists notif_dedup_idx
  on finance.notifications_inbox (user_id, dedup_key)
  where dedup_key is not null;

create index if not exists notif_user_unread_idx
  on finance.notifications_inbox (user_id, read_at, created_at desc);

alter table finance.notifications_inbox enable row level security;

create policy "owner_all" on finance.notifications_inbox
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Per-kind toggle ({ kind: { in_app: bool, email: bool } }). Missing kind
-- defaults to in_app=true, email=false. Email is a stub for now.
create table if not exists finance.notification_prefs (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  prefs      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table finance.notification_prefs enable row level security;

create policy "owner_all" on finance.notification_prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
