-- Freelane: app changelog infrastructure.
--
-- A single source of truth for "what changed in Freelane lately." The web app
-- renders it as a /changelog page; the future macOS Swift app reads the same
-- table via the Supabase REST endpoint to populate its "What's New" menu.
-- Both clients display the same release narrative — no separate marketing copy.
--
-- This is a SINGLE-USER changelog (Hatim's own dev log against his own app),
-- so RLS scopes by author_id but anyone authenticated as the owner can read.
-- Entries get version-tagged (semver-ish — "2026.06.A", "2026.06.B" calendar
-- versioning is fine, this is not a published SaaS).
--
-- kind:
--   release     — meaningful new capability or feature, headlines the page
--   improvement — tightening of an existing feature; smaller card
--   fix         — bug fix; bullet under a release
--   note        — meta note ("starting Tier 2 next", "macOS app build kickoff")
--
-- highlights is a free-form jsonb array of strings the UI renders as a
-- bullet list. body is full markdown for longer write-ups; nullable for
-- the short cases where highlights alone says enough.

create type finance.app_changelog_kind as enum ('release', 'improvement', 'fix', 'note');

create table if not exists finance.app_changelog (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null references auth.users(id) on delete cascade,
  version       text not null,                       -- "2026.06.A"
  released_at   date not null default current_date,
  kind          finance.app_changelog_kind not null default 'release',
  title         text not null,
  body          text,                                -- markdown
  highlights    jsonb not null default '[]'::jsonb,  -- ["bullet 1", "bullet 2"]
  -- The tier number this entry belongs to (1-5 per the build plan).
  -- Nullable for incidental fixes that don't map to a tier.
  tier          integer check (tier between 0 and 9),
  is_pinned     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists app_changelog_version_idx
  on finance.app_changelog (author_id, version);

create index if not exists app_changelog_released_idx
  on finance.app_changelog (author_id, released_at desc, created_at desc);

create index if not exists app_changelog_pinned_idx
  on finance.app_changelog (author_id, released_at desc)
  where is_pinned = true;

create trigger app_changelog_touch
  before update on finance.app_changelog
  for each row execute function finance.touch_updated_at();

alter table finance.app_changelog enable row level security;

create policy "owner_all" on finance.app_changelog
  for all using (auth.uid() = author_id) with check (auth.uid() = author_id);

-- Seed the inaugural Tier 1 entry so the page isn't empty on first visit.
-- Tier-1 ship gets logged as a single bundled release; subsequent Tiers add
-- their own version stamps.
insert into finance.app_changelog (author_id, version, released_at, kind, title, body, highlights, tier, is_pinned)
select s.user_id,
       '2026.06.A',
       current_date,
       'release',
       'Tier 1 — Foundation + harsh-period spine',
       'Eleven Tier-1 features land in this drop. Calm Weather Mode reads your whole financial weather and writes one honest line; Pre-Commitment Runway Lock parks money for the MacBook before you can spend it; Pre-Mortem on Big Plans walks the 90-day liquidity around every large planned spend; 90-Day Cashflow Atlas charts where the next quarter actually goes; Investment vs Consumption tags the difference between things that pay back and things that just leave; Tight Mode Coach narrows the picture when the numbers do; Forecast Storyteller writes next month''s shape in your voice; spends get a time-of-day field; every spend item, planned spend, and AI answer gets a notes field. The app changelog goes live with this entry.',
       '[
         "Calm Weather Mode — the one honest line under everything",
         "Pre-Commitment Runway Lock for the MacBook drop",
         "Pre-Mortem on Big Plans with 90-day liquidity narrative",
         "90-Day Cashflow Atlas chart on the dashboard",
         "Investment vs Consumption Ledger on /spending",
         "Tight Mode Coach when the runway tightens",
         "Forecast Storyteller card for next month",
         "Time-of-day on every spend",
         "Universal notes finished (items, plans, AI answers)",
         "App changelog goes live"
       ]'::jsonb,
       1,
       true
from finance.settings s
on conflict (author_id, version) do nothing;
