-- Freelane: finish the universal-notes rule (Hatim 2026-06-01).
--
-- Every entity in Freelane should expose a freeform notes field so the user
-- can write context the AI reads on every consolidation pass. Most tables
-- already have it (spends, payments, recurring_spends, loans, withdrawals,
-- clients, projects, payment_methods, user_memory_entries, planned_spends).
-- Two surfaces were still missing:
--
--   1. spend_items.notes — the individual line items inside a spend often
--      carry context worth keeping ("the 5kg bag was on sale", "two boxes
--      because Lola asked"). Without a notes column, users compress that
--      context into the item name + lose searchability.
--
--   2. ai_questions.answer_notes — the AI question card pairs tap-to-answer
--      chips with a free-text box. The chip lands in `answer`; the free-text
--      box lands here. Future memory consolidation reads BOTH so the AI sees
--      "I picked 'Bulk buy' AND wrote 'for the trip to Cebu next week'."

alter table finance.spend_items
  add column if not exists notes text;

alter table finance.ai_questions
  add column if not exists answer_notes text;
