-- Freelane: activity events + invoice reminder tracking.
-- 1) An append-only events log, surfaced as an app-wide activity feed and as
--    a per-client timeline. Designed to be friendly to future AI context.
-- 2) `invoices.last_reminded_at` + `invoice_reminder_days` in settings so the
--    dashboard can nudge about unpaid invoices.

create table if not exists finance.events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null,
  entity_type text,
  entity_id   uuid,
  client_id   uuid references finance.clients(id) on delete set null,
  title       text not null,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists events_user_time_idx   on finance.events (user_id, created_at desc);
create index if not exists events_entity_idx      on finance.events (entity_type, entity_id);
create index if not exists events_client_time_idx on finance.events (client_id, created_at desc);

alter table finance.events enable row level security;
create policy "owner_all" on finance.events
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Invoice reminder tracking
alter table finance.invoices
  add column if not exists last_reminded_at timestamptz;

alter table finance.settings
  add column if not exists invoice_reminder_days integer not null default 7;
