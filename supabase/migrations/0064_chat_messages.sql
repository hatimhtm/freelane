-- Freelane: per-page persistent chat history.
--
-- Each message is tagged with a session_id (UUID generated at session start
-- by the chat server action) AND a page_key (so the active-page view can
-- show ONLY conversations that happened on that page). Sessions end on
-- visibilitychange-hidden-5m, beforeunload, 30m idle, or explicit "clear
-- chat" — at which point session-summarizer compresses the rows into a
-- chat_session_summaries row and sets archived_at = now() here.
--
-- page_context jsonb stores the PageContext snapshot at send time so the
-- Pro model can reason about WHERE the user was when they asked, even on
-- replay after a navigation.

create table if not exists finance.chat_messages (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  session_id    uuid not null,
  page_key      text not null,
  role          text not null check (role in ('user','assistant','system')),
  content       text not null,
  tokens        int,
  page_context  jsonb,
  created_at    timestamptz not null default now(),
  archived_at   timestamptz
);

-- Per-page recent history: the chat modal asks "what did I say on this
-- surface lately" — sorted by created_at desc.
create index if not exists chat_messages_user_page_idx
  on finance.chat_messages (user_id, page_key, created_at desc);

-- Per-session ordered playback: the Pro brain replays the active session in
-- order to maintain conversational continuity.
create index if not exists chat_messages_user_session_idx
  on finance.chat_messages (user_id, session_id, created_at);

-- Active-session partial index: most reads ignore archived rows (they're
-- already compressed into a summary), so a partial keeps the hot path tight.
create index if not exists chat_messages_active_idx
  on finance.chat_messages (user_id, session_id)
  where archived_at is null;

alter table finance.chat_messages enable row level security;

create policy "chat_messages_owner_all" on finance.chat_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table finance.chat_messages is
  'Per-page persistent chat. archived_at NOT NULL means the row has been compressed into chat_session_summaries by the session-summarizer brain.';
