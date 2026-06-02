-- Freelane: entity-scoped facts table for the chatbot's living memory.
--
-- The brain accumulates small structured facts about the user (and, once the
-- Clients/Vendors/Entities workflows ship, about any addressable subject) by
-- asking + inferring + seeding. Facts feed back into the state snapshot so
-- the next conversation turn already knows what the user told the brain
-- yesterday.
--
-- subject_kind is checked against the full enum-set now, even though only
-- 'user'-scoped facts exist on day one — future workflows (per-client
-- preferences, per-vendor patterns, per-plan checkpoints) drop in without a
-- second migration. subject_id is nullable because user-scoped facts have no
-- secondary subject; the unique guarantee is split across two partial
-- indexes to handle null subject_id correctly (a plain UNIQUE treats NULL as
-- distinct and would let duplicate user facts slip in).

create table if not exists finance.ai_user_facts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  subject_kind  text not null default 'user'
                  check (subject_kind in ('user','client','vendor','project','plan','entity')),
  subject_id    uuid,
  key           text not null,
  value         jsonb not null,
  confidence    numeric(3,2) not null default 0.5
                  check (confidence >= 0 and confidence <= 1),
  source        text not null default 'inferred'
                  check (source in ('user_answered','inferred','seeded')),
  evidence      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Two partial uniques cover the (subject_kind, subject_id, key) tuple
-- whether subject_id is null (user-scoped facts) or not. A single composite
-- UNIQUE wouldn't reject duplicates when subject_id is null because SQL
-- treats NULL = NULL as unknown.
create unique index if not exists ai_user_facts_user_subject_key_uniq_null
  on finance.ai_user_facts (user_id, subject_kind, key)
  where subject_id is null;

create unique index if not exists ai_user_facts_user_subject_key_uniq_notnull
  on finance.ai_user_facts (user_id, subject_kind, subject_id, key)
  where subject_id is not null;

create index if not exists ai_user_facts_lookup_idx
  on finance.ai_user_facts (user_id, subject_kind, subject_id);

alter table finance.ai_user_facts enable row level security;

create policy "ai_user_facts_owner_all" on finance.ai_user_facts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- updated_at trigger — reuses the same simple touch helper convention as the
-- other tables in this codebase. Inline create-or-replace keeps the migration
-- self-contained; if a project-wide helper exists later this can switch.
create or replace function finance.touch_ai_user_facts() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists ai_user_facts_touch on finance.ai_user_facts;
create trigger ai_user_facts_touch
  before update on finance.ai_user_facts
  for each row execute function finance.touch_ai_user_facts();

comment on table finance.ai_user_facts is
  'Entity-scoped facts the chatbot accumulates. subject_kind+subject_id locate the subject; user-scoped facts use subject_kind=user, subject_id=null. Source distinguishes user_answered (1.0 confidence) from inferred or seeded.';
