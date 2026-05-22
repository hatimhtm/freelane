-- Freelane: stop auto-flagging projects as overdue.
--
-- The previous dashboard derived "overdue" from project.due_date < today.
-- That's noisy — most freelance work has soft deadlines, and the boss is
-- "always" late in a known, fine way. New rule: only show "overdue" when
-- the user explicitly raises the flag.
--
-- The flag also feeds the new pending view's urgency ranking
-- (amount × days_aged × (flagged ? 1.5 : 1)).

alter table finance.projects
  add column if not exists flagged_overdue        boolean      not null default false,
  add column if not exists flagged_overdue_at     timestamptz,
  add column if not exists flagged_overdue_reason text;

create index if not exists projects_flagged_overdue_idx
  on finance.projects (user_id)
  where flagged_overdue = true;
