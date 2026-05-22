-- Freelane: client memory.
--
-- Each time you open a client, there's an empty "what's new about them?" box.
-- You drop a sentence ("ViralFactory finally paid Q1 today, ~12 days late").
-- Gemini reads it, cross-references the existing consolidated memory, and
-- updates a single living document about that client. The raw entries stay
-- (so you can audit / revisit), but the consolidated doc is what's fed to
-- Gemini for every insight after that.
--
-- This mirrors the auto-memory pattern from his own Claude workspace.

create table if not exists finance.client_memory_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  client_id   uuid not null references finance.clients(id) on delete cascade,
  content     text not null check (length(content) > 0),
  consolidated_at  timestamptz,  -- null = waiting on Gemini; set = merged
  created_at  timestamptz not null default now()
);

create index if not exists client_memory_entries_client_idx
  on finance.client_memory_entries (client_id, created_at desc);

alter table finance.client_memory_entries enable row level security;

create policy "owner_all" on finance.client_memory_entries
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── Augment clients ────────────────────────────────────────────────────

alter table finance.clients
  add column if not exists short_description  text,
  add column if not exists memory_consolidated jsonb not null default '{}'::jsonb;

-- The consolidated shape (loose schema, Gemini-managed):
--   {
--     "summary":  "ViralFactory — boss, pays in CNY via bank+RedDot+GCash chain. Reliable but slow.",
--     "facts":    ["Pays around the 15th", "Prefers CNY", "Quarterly bonus in Dec"],
--     "watch":    ["Last late payment Apr 2026 — 18d"],
--     "preferences": {"language": "fr", "tone": "casual"},
--     "updated_at": "2026-05-22T08:30:00Z",
--     "entry_count": 17
--   }
