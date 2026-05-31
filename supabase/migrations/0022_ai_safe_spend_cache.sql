-- Freelane: cache for the AI safe-to-spend insight.
--
-- Layer architecture (see src/lib/safe-to-spend.ts + src/lib/ai/safe-to-spend-ai.ts):
--   1. Rule-based baseline   — pure function, runs every page load, ~0ms, no AI.
--   2. Gemini overlay        — replaces v1 placeholder pattern_multiplier with a
--                              learned per-you value + verdict + watchouts.
--   3. THIS CACHE            — 2h TTL on the Gemini overlay. Reads check
--                              generated_at and call Gemini again on expiry.
--
-- Invalidation: server actions that change the math (spend.added, payment.added,
-- withdrawal.added, recurring_spend.paid, loan_installment.paid, etc.) DELETE
-- this row, forcing a fresh recompute on the next read.
--
-- Fallback: if Gemini is unconfigured / errors, the UI falls back to pure
-- rule-based with a soft "AI offline" indicator — the cache stays empty.

create table if not exists finance.ai_safe_spend_cache (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  -- Stored shape (loose): the SafeToSpendBreakdown plus the Gemini overlay
  -- ({verdict, oneLineReasoning, watchouts[], trajectory, sadakaSuggestion,
  -- patternMultiplier, isLearning}). Frontend reads it raw.
  insight       jsonb not null,
  generated_at  timestamptz not null default now()
);

alter table finance.ai_safe_spend_cache enable row level security;

create policy "owner_all" on finance.ai_safe_spend_cache
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
