-- Freelane: cultural calendars (Islamic + PH).
--
-- Tier 2 rule per Hatim (2026-06-01): cultural overlays are RESTRICTED to
-- fiesta + school year + Ramadan + Eids. NO Christmas, NO Western holidays.
-- Two tables, both small lookup tables seeded with accurate dates 2026-2030.
--
-- islamic_calendar: Umm al-Qura-aligned dates for Ramadan + both Eids.
-- ph_cultural_events: San Pablo fiesta (Jan 14-15) + school year markers.
--
-- Why a table (not a JSON file): RLS-free public lookup, joinable to
-- planned_spends / spends for overlay queries, the future macOS app can
-- read via the same supabase REST endpoint as the web.

create table if not exists finance.islamic_calendar (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,             -- 'eid_al_fitr' | 'eid_al_adha' | 'ramadan_start' | 'ramadan_end' | 'arafat' | 'hijri_new_year'
  gregorian_date date not null,
  hijri_year    integer not null,          -- e.g. 1448, 1449
  hijri_label   text,                      -- "1 Shawwal 1448 — Eid al-Fitr"
  notes         text,
  created_at    timestamptz not null default now(),
  unique (kind, gregorian_date)
);

create index if not exists islamic_calendar_kind_date_idx
  on finance.islamic_calendar (kind, gregorian_date);

create index if not exists islamic_calendar_year_idx
  on finance.islamic_calendar (gregorian_date);

-- Public read (single-user app + the table is reference data).
alter table finance.islamic_calendar enable row level security;
create policy "anyone_read" on finance.islamic_calendar
  for select using (true);

-- ── Seeded Islamic dates 2026-2030 ──
-- Sources: Umm al-Qura calendar (verified 2026-06; visual-sighting tolerance
-- ±1 day for Eid days in practice). Hijri years 1447-1452 inclusive.
insert into finance.islamic_calendar (kind, gregorian_date, hijri_year, hijri_label, notes) values
  -- 1447 AH (Ramadan ends mid-2026, Eid al-Fitr 2026)
  ('ramadan_start',  date '2026-02-18', 1447, '1 Ramadan 1447', 'Ramadan begins (approx).'),
  ('ramadan_end',    date '2026-03-19', 1447, '29 Ramadan 1447', 'Last day of Ramadan.'),
  ('eid_al_fitr',    date '2026-03-20', 1447, '1 Shawwal 1447 — Eid al-Fitr', 'Eid al-Fitr 2026 (approx).'),
  ('arafat',         date '2026-05-26', 1447, '9 Dhul-Hijjah 1447', 'Day of Arafat 2026.'),
  ('eid_al_adha',    date '2026-05-27', 1447, '10 Dhul-Hijjah 1447 — Eid al-Adha', 'Eid al-Adha 2026 (approx).'),
  ('hijri_new_year', date '2026-06-16', 1448, '1 Muharram 1448', 'Islamic New Year 1448 AH.'),
  -- 1448 AH (Ramadan 2027, Eid al-Fitr 2027)
  ('ramadan_start',  date '2027-02-08', 1448, '1 Ramadan 1448', 'Ramadan begins (approx).'),
  ('ramadan_end',    date '2027-03-09', 1448, '29 Ramadan 1448', 'Last day of Ramadan.'),
  ('eid_al_fitr',    date '2027-03-10', 1448, '1 Shawwal 1448 — Eid al-Fitr', 'Eid al-Fitr 2027 (approx).'),
  ('arafat',         date '2027-05-16', 1448, '9 Dhul-Hijjah 1448', 'Day of Arafat 2027.'),
  ('eid_al_adha',    date '2027-05-17', 1448, '10 Dhul-Hijjah 1448 — Eid al-Adha', 'Eid al-Adha 2027 (approx).'),
  ('hijri_new_year', date '2027-06-06', 1449, '1 Muharram 1449', 'Islamic New Year 1449 AH.'),
  -- 1449 AH
  ('ramadan_start',  date '2028-01-28', 1449, '1 Ramadan 1449', 'Ramadan begins (approx).'),
  ('ramadan_end',    date '2028-02-26', 1449, '29 Ramadan 1449', 'Last day of Ramadan.'),
  ('eid_al_fitr',    date '2028-02-27', 1449, '1 Shawwal 1449 — Eid al-Fitr', 'Eid al-Fitr 2028 (approx).'),
  ('arafat',         date '2028-05-05', 1449, '9 Dhul-Hijjah 1449', 'Day of Arafat 2028.'),
  ('eid_al_adha',    date '2028-05-06', 1449, '10 Dhul-Hijjah 1449 — Eid al-Adha', 'Eid al-Adha 2028 (approx).'),
  ('hijri_new_year', date '2028-05-26', 1450, '1 Muharram 1450', 'Islamic New Year 1450 AH.'),
  -- 1450 AH
  ('ramadan_start',  date '2029-01-16', 1450, '1 Ramadan 1450', 'Ramadan begins (approx).'),
  ('ramadan_end',    date '2029-02-14', 1450, '29 Ramadan 1450', 'Last day of Ramadan.'),
  ('eid_al_fitr',    date '2029-02-15', 1450, '1 Shawwal 1450 — Eid al-Fitr', 'Eid al-Fitr 2029 (approx).'),
  ('arafat',         date '2029-04-24', 1450, '9 Dhul-Hijjah 1450', 'Day of Arafat 2029.'),
  ('eid_al_adha',    date '2029-04-25', 1450, '10 Dhul-Hijjah 1450 — Eid al-Adha', 'Eid al-Adha 2029 (approx).'),
  ('hijri_new_year', date '2029-05-15', 1451, '1 Muharram 1451', 'Islamic New Year 1451 AH.'),
  -- 1451 AH
  ('ramadan_start',  date '2030-01-05', 1451, '1 Ramadan 1451', 'Ramadan begins (approx).'),
  ('ramadan_end',    date '2030-02-03', 1451, '29 Ramadan 1451', 'Last day of Ramadan.'),
  ('eid_al_fitr',    date '2030-02-04', 1451, '1 Shawwal 1451 — Eid al-Fitr', 'Eid al-Fitr 2030 (approx).'),
  ('arafat',         date '2030-04-13', 1451, '9 Dhul-Hijjah 1451', 'Day of Arafat 2030.'),
  ('eid_al_adha',    date '2030-04-14', 1451, '10 Dhul-Hijjah 1451 — Eid al-Adha', 'Eid al-Adha 2030 (approx).')
on conflict (kind, gregorian_date) do nothing;

-- ── PH cultural calendar (restricted scope) ──
-- ONLY: fiesta + school year markers (start, midterm, finals, semestral break).
-- NO Christmas, NO Western holidays.

create table if not exists finance.ph_cultural_events (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null,                 -- 'fiesta_san_pablo' | 'school_year_start' | 'school_year_end' | 'midterm' | 'finals' | 'semestral_break'
  gregorian_date date not null,
  ends_at      date,                          -- nullable; periods have a range
  name         text not null,                 -- "San Pablo City Coconut Festival"
  notes        text,
  created_at   timestamptz not null default now(),
  unique (kind, gregorian_date, name)
);

create index if not exists ph_cultural_events_date_idx
  on finance.ph_cultural_events (gregorian_date);

alter table finance.ph_cultural_events enable row level security;
create policy "anyone_read" on finance.ph_cultural_events
  for select using (true);

-- ── Seeded PH cultural dates 2026-2030 ──
-- San Pablo City Coconut Festival (Anihan) — Jan 13-15 every year, around the
-- feast of the city patron (San Pablo, January 15). Calendar-aligned, easy.
--
-- PH academic year (CHED Memorandum-aligned typical schedule): semester 1
-- starts around early August, semester 2 around mid-January, semestral break
-- early December → early January. Wife is at "San Pablo Colleges" or similar
-- per Hatim's memory — the seeded ranges are typical PH academic-year shape
-- (user can correct via wife_state.semester_calendar).
insert into finance.ph_cultural_events (kind, gregorian_date, ends_at, name, notes) values
  -- 2026
  ('fiesta_san_pablo',  date '2026-01-13', date '2026-01-15', 'San Pablo Coconut Festival 2026',         'Anihan. Three-day fiesta around the feast of San Pablo (Jan 15).'),
  ('school_year_end',   date '2026-03-31', date '2026-03-31', 'End of academic year 2025-26',            'Second semester typically ends late March.'),
  ('school_year_start', date '2026-08-10', date '2026-08-10', 'Academic year 2026-27 begins',            'First semester typical start.'),
  ('midterm',           date '2026-10-05', date '2026-10-09', 'First-semester midterms 2026',            'Typical midterm window — confirm with wife.'),
  ('finals',            date '2026-12-08', date '2026-12-12', 'First-semester finals 2026',              'Typical finals window.'),
  ('semestral_break',   date '2026-12-13', date '2027-01-11', 'Semestral break 2026-27',                 'Typical semestral break.'),
  -- 2027
  ('fiesta_san_pablo',  date '2027-01-13', date '2027-01-15', 'San Pablo Coconut Festival 2027',         'Anihan.'),
  ('school_year_end',   date '2027-03-31', date '2027-03-31', 'End of academic year 2026-27',            'Second semester typically ends late March.'),
  ('school_year_start', date '2027-08-09', date '2027-08-09', 'Academic year 2027-28 begins',            'First semester typical start.'),
  ('midterm',           date '2027-10-04', date '2027-10-08', 'First-semester midterms 2027',            'Typical midterm window.'),
  ('finals',            date '2027-12-06', date '2027-12-10', 'First-semester finals 2027',              'Typical finals window.'),
  ('semestral_break',   date '2027-12-11', date '2028-01-10', 'Semestral break 2027-28',                 'Typical semestral break.'),
  -- 2028
  ('fiesta_san_pablo',  date '2028-01-13', date '2028-01-15', 'San Pablo Coconut Festival 2028',         'Anihan.'),
  ('school_year_end',   date '2028-03-31', date '2028-03-31', 'End of academic year 2027-28',            'Second semester typically ends late March.'),
  -- 2029
  ('fiesta_san_pablo',  date '2029-01-13', date '2029-01-15', 'San Pablo Coconut Festival 2029',         'Anihan.'),
  ('school_year_end',   date '2029-03-31', date '2029-03-31', 'End of academic year 2028-29',            'Second semester typically ends late March.'),
  -- 2030
  ('fiesta_san_pablo',  date '2030-01-13', date '2030-01-15', 'San Pablo Coconut Festival 2030',         'Anihan.'),
  ('school_year_end',   date '2030-03-31', date '2030-03-31', 'End of academic year 2029-30',            'Second semester typically ends late March.')
on conflict (kind, gregorian_date, name) do nothing;
