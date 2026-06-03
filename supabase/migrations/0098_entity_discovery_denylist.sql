-- Freelane: entity discovery denylist (Entities workflow — Gate 1 rejections).
--
-- When the user taps "Not an entity" on an entity_discovery_request
-- notification, the proposed name needs to be remembered forever so the
-- AI never re-proposes the same name from a future signal. Without this
-- list, propose-entity-from-signal would keep firing on every spend that
-- mentions the rejected name and the user would keep dismissing the same
-- notification — annoying AND a slow accumulation of unanswered work.
--
-- name_normalized is lowercase + alpha-only so spelling variations and
-- punctuation differences collapse onto the same denylist entry
-- ("Junjun", "junjun", "Jun-jun" → "junjun"). The unique(user_id,
-- name_normalized) constraint prevents duplicate rows when the same
-- name surfaces from multiple signals.
--
-- rejection_context jsonb captures WHAT signal proposed the name and WHY
-- the user said no (when the modal collects that). Used for analytics +
-- future tuning of propose-entity-from-signal.

create table if not exists finance.entity_discovery_denylist (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  name_normalized     text not null,
  rejected_at         timestamptz not null default now(),
  rejection_context   jsonb,
  unique (user_id, name_normalized)
);

create index if not exists entity_discovery_denylist_user_idx
  on finance.entity_discovery_denylist (user_id);

alter table finance.entity_discovery_denylist enable row level security;

create policy "owner_all" on finance.entity_discovery_denylist
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table finance.entity_discovery_denylist is
  'Names the user has explicitly rejected as entities via the entity_discovery_request "Not an entity" action. propose-entity-from-signal must check this list before proposing.';
comment on column finance.entity_discovery_denylist.name_normalized is
  'Lowercase alpha-only form of the rejected name. Built via lower(regexp_replace(name, ''[^a-z0-9]+'', '''', ''g'')). Collapses spelling variations onto the same row.';
comment on column finance.entity_discovery_denylist.rejection_context is
  'JSON envelope capturing the signal that proposed the name: {source_kind, source_text, signal_fingerprint}. Used for analytics and future propose-entity-from-signal tuning.';
