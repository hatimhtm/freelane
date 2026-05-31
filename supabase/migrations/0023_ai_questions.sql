-- Freelane: AI questions queue — the AI's curiosity surface across the life-OS.
--
-- Max wants the AI to be "really really curious" across the WHOLE life-OS —
-- clients, payments, revenue, investments, notes, recurring, loans. Whenever
-- the AI notices something it can't explain from the data alone, it queues a
-- question here instead of guessing or staying silent.
--
-- Lifecycle: a question is created (queued) → either Max answers it (answer +
-- answered_at), or he dismisses it (dismissed_at). The hot path is "open
-- questions only" (neither answered nor dismissed), which the partial index
-- below makes cheap to scan even as the archive grows.
--
-- context carries the raw data that prompted the question (the spend row, the
-- payment, the memory entry…) so the AI can reconstruct WHY it asked without
-- a second round-trip. options is an optional list of pre-filled answer chips
-- the UI can render as tap-to-answer pills (e.g. ["Bulk buy", "Price went up",
-- "Different store"]). source_entity_type + source_entity_id let the UI link
-- back to the originating record so Max can tap through and see what the AI
-- saw.

create table if not exists finance.ai_questions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  question            text not null,
  -- TEXT (not a pg enum) on purpose — new kinds get added as the life-OS grows
  -- (deal_check, coaching, note_followup, …) and we don't want to alter-type
  -- the enum every time. Known values today:
  --   clarify_spend | clarify_payment | clarify_client | clarify_recurring
  --   clarify_loan  | clarify_investment | clarify_revenue | memory_gap
  --   restructure_suggestion | deal_check | coaching | note_followup
  kind                text not null,
  context             jsonb not null default '{}'::jsonb,
  options             jsonb,
  -- "spend" | "payment" | "client" | "loan" | "recurring_spend" |
  -- "user_memory_entry" | null. Free-form TEXT for the same reason as `kind`.
  source_entity_type  text,
  source_entity_id    uuid,
  priority            integer not null default 5 check (priority between 1 and 9),
  created_at          timestamptz not null default now(),
  answered_at         timestamptz,
  answer              text,
  dismissed_at        timestamptz
);

-- Hot path: the inbox of open questions, newest first. Partial index keeps it
-- tight as the answered/dismissed archive grows.
create index if not exists ai_questions_open_idx
  on finance.ai_questions (user_id, created_at desc)
  where answered_at is null and dismissed_at is null;

-- Used when the UI / AI wants "all questions about THIS spend / payment / loan"
-- (e.g. when opening a spend detail sheet, show the open AI questions about it).
create index if not exists ai_questions_source_idx
  on finance.ai_questions (user_id, source_entity_type, source_entity_id);

alter table finance.ai_questions enable row level security;

create policy "owner_all" on finance.ai_questions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
