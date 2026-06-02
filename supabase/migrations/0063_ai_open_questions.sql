-- Freelane: bidirectional clarifying-question queue.
--
-- The brain decides what it doesn't yet know — and queues a question. A
-- background trigger (daily PHT midnight + significant-event hooks) surfaces
-- the highest-value question to the user via the Notifications system; the
-- user's answer flows into ai_user_facts and closes the question. Skipped
-- questions raise the gain threshold for siblings (backoff).
--
-- Entity-scoped from day one to match ai_user_facts. A Clients workflow can
-- attach per-client questions ("does Vendor X invoice monthly?") without a
-- second migration.

create table if not exists finance.ai_open_questions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  subject_kind         text not null default 'user'
                          check (subject_kind in ('user','client','vendor','project','plan','entity')),
  subject_id           uuid,
  question_key         text not null,
  question_text        text not null,
  suggested_answers    jsonb not null default '[]'::jsonb,
  free_text            boolean not null default false,
  priority             numeric(3,2) not null default 0.5
                          check (priority >= 0 and priority <= 1),
  fact_key             text not null,
  confidence_gain      numeric(3,2) not null default 0.3
                          check (confidence_gain >= 0 and confidence_gain <= 1),
  status               text not null default 'queued'
                          check (status in ('queued','asked','answered','dismissed','expired')),
  asked_at             timestamptz,
  answered_at          timestamptz,
  dismissed_at         timestamptz,
  dismissal_count      int not null default 0,
  last_notification_id uuid,
  created_at           timestamptz not null default now()
);

-- Same partial-uniques trick as ai_user_facts so (user, subject, question_key)
-- is enforced both when subject_id is null (user-scoped) and not null.
create unique index if not exists ai_open_questions_user_subject_qkey_uniq_null
  on finance.ai_open_questions (user_id, subject_kind, question_key)
  where subject_id is null;

create unique index if not exists ai_open_questions_user_subject_qkey_uniq_notnull
  on finance.ai_open_questions (user_id, subject_kind, subject_id, question_key)
  where subject_id is not null;

-- Queue index: pick-next-question scans this often (status='queued' filtered
-- by priority desc), so a covering index here keeps it cheap.
create index if not exists ai_open_questions_queue_idx
  on finance.ai_open_questions (user_id, status, priority desc);

create index if not exists ai_open_questions_subject_idx
  on finance.ai_open_questions (user_id, subject_kind, subject_id);

alter table finance.ai_open_questions enable row level security;

create policy "ai_open_questions_owner_all" on finance.ai_open_questions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table finance.ai_open_questions is
  'Clarifying questions the brain wants answered. Status lifecycle: queued -> asked -> answered/dismissed/expired. value = priority * (1 - existing_confidence) drives selection; dismissal_count drives backoff.';
