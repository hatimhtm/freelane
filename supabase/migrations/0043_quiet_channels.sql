-- Freelane: Quiet-Channel Watcher (Tier 5 — #18 modified).
--
-- Hatim 2026-06-01: "MUST USE the data to auto-write notes into client
-- profiles. Sander goes silent → AI asks → answer becomes client memory."
--
-- Detection: a client has at least one previous payment but no payment in
-- the last 45-180 days AND no recent activity (no project edits, no notes
-- added, no manual flags). The watcher queues an ai_questions row tied to
-- the client. When Hatim answers, the answer becomes a client_memory_entries
-- row on the client (so the corpus learns "Sander paused for 2 months due
-- to a hiring freeze" without manual entry).
--
-- This table records ONE row per (user, client_id, detected_at) so the
-- watcher can dedupe and surface the "currently quiet" set in /clients
-- without re-running detection on every page render.

create table if not exists finance.quiet_channels (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  client_id      uuid not null references finance.clients(id) on delete cascade,
  -- When the silence was first detected (the day this row was written).
  detected_at    date not null default current_date,
  -- Days of silence at detection time (computed from last payment / last
  -- project edit, whichever is more recent).
  silence_days   integer not null check (silence_days >= 0),
  -- The ai_question row that was queued asking about it. Nullable when AI
  -- is off / question wasn't queued for some reason.
  ai_question_id uuid references finance.ai_questions(id) on delete set null,
  -- When the user answered (or null if still open).
  resolved_at    timestamptz,
  -- Hatim's reply, captured here AS WELL as on the ai_questions row so the
  -- watcher can analyze recurring patterns ("Sander's silence usually
  -- means a hiring freeze") without re-joining tables.
  reply          text,
  -- AI-built short summary written back into client_memory_entries.
  -- Nullable — only populated after reply is set.
  written_to_memory_entry_id uuid references finance.client_memory_entries(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists quiet_channels_user_open_idx
  on finance.quiet_channels (user_id, detected_at desc)
  where resolved_at is null;

create index if not exists quiet_channels_client_idx
  on finance.quiet_channels (client_id, detected_at desc);

create trigger quiet_channels_touch
  before update on finance.quiet_channels
  for each row execute function finance.touch_updated_at();

alter table finance.quiet_channels enable row level security;

create policy "owner_all" on finance.quiet_channels
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
