-- Freelane: household tag + wife state.
--
-- Two layers added together:
--   1. spends.for_us boolean (Tier 2 F — "It's For Us" Tag). Distinct from the
--      "Wife" category (which means money spent ON her). "It's for us" means
--      money spent FOR THE HOUSEHOLD — a chair for both, a meal for both, a
--      streaming subscription they share. The Year Letter (#8) eventually
--      reads "this year you spent ₱X on the household — the largest single
--      line."
--   2. wife_state single row (Tier 2 A — Wife's Uni Calendar Memory). Wife is
--      a uni student; her semester rhythm is AMBIENT context for the AI. She
--      pays her own tuition, finances aren't pooled, but the AI knowing
--      "exam week starts Friday" makes the conversation feel alive.
--
-- The wife_state row is keyed by user_id (one Hatim = one wife in this model).
-- semester_calendar jsonb shape (loose, evolves):
--   { current: { name: "S2 2025-26", starts: "2026-06-09", ends: "2026-10-15",
--                exams: [{ kind: "midterm", starts, ends }, { kind: "finals", ... }] },
--     upcoming: [...] }

alter table finance.spends
  add column if not exists for_us boolean not null default false;

-- Partial index on the "for_us" surface for the Year Letter / household roll-up.
create index if not exists spends_for_us_idx
  on finance.spends (user_id, spent_at desc)
  where for_us = true;

create table if not exists finance.wife_state (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  -- Name (optional, "Wife" is the default UI label).
  name                 text,
  -- University details — the AI uses these as ambient ("San Pablo Colleges
  -- midterms start next week — wife will be at home more").
  university           text,
  year_of_study        integer check (year_of_study between 1 and 6),
  expected_graduation  date,
  -- The structured semester rhythm. Updated by user or by AI (ai_questions
  -- can ask "Your wife's midterms — when?" and write back here).
  semester_calendar    jsonb not null default '{}'::jsonb,
  -- Free-form preference notes the AI consolidates from Wife-tagged spends
  -- and wife-mentioning user_memory entries. Mirrors client memory pattern.
  preferences_consolidated jsonb not null default '{}'::jsonb,
  -- Last time the corpus brain folded new entries into preferences_consolidated.
  preferences_consolidated_at timestamptz,
  notes                text,
  updated_at           timestamptz not null default now()
);

create trigger wife_state_touch
  before update on finance.wife_state
  for each row execute function finance.touch_updated_at();

alter table finance.wife_state enable row level security;

create policy "owner_all" on finance.wife_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Seed a starter row for the existing user so the AI has somewhere to write
-- consolidated preferences without a special-case create path.
insert into finance.wife_state (user_id, year_of_study, notes)
select s.user_id, 3,
       'Seeded by migration 0034. Hatim 2026-06-01: wife works + pays her own tuition + they don''t live together yet.'
from finance.settings s
where not exists (
  select 1 from finance.wife_state ws where ws.user_id = s.user_id
);
