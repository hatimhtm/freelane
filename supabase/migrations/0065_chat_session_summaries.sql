-- Freelane: end-of-session chat digests.
--
-- One row per ended chat session. Written by session-summarizer (Flash Lite
-- brain) on session-end triggers. Used by chat-answer (Pro brain) as
-- compressed history so the conversation feels continuous across sessions
-- without burning Pro tokens on raw message replay.
--
-- The Pro brain reads the last 5 summaries for the active page_key plus the
-- live current-session messages. Together they stay well under 8k tokens
-- even for chatty users.

create table if not exists finance.chat_session_summaries (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  session_id     uuid not null unique,
  page_key       text not null,
  summary        text not null,
  message_count  int not null,
  started_at     timestamptz not null,
  ended_at       timestamptz not null,
  created_at     timestamptz not null default now()
);

create index if not exists chat_session_summaries_recent_idx
  on finance.chat_session_summaries (user_id, page_key, ended_at desc);

alter table finance.chat_session_summaries enable row level security;

create policy "chat_session_summaries_owner_all" on finance.chat_session_summaries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table finance.chat_session_summaries is
  'Flash Lite end-of-session digests. Read by Pro chat-answer to maintain continuity across sessions without raw-message token burn.';
