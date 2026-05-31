-- Freelane: Project-Note Rate Insight (Tier 5 — feature E, replaces #16).
--
-- Hatim 2026-06-01: "AI reads project notes for friction. Surfaces calm
-- note + free-text box. Reply feeds rate reasoning."
--
-- The rate insight brain scans ALL project notes + recent communications
-- (the existing project + client memory corpora) for friction signals:
-- complaints about scope, time spent vs paid, repeated revisions, etc.
-- When enough friction accumulates for a client, it surfaces ONE calm
-- observation ("4 of your last 6 projects with Sander mention scope creep")
-- and asks Hatim a single open question. Hatim's reply feeds the rate
-- reasoning corpus + can update the client's rate.
--
-- The corpus is what makes the future "should I raise my rate with Sander?"
-- conversation grounded — the brain reads this table to remember why it
-- proposed the rate change.

create table if not exists finance.rate_insights (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  client_id       uuid references finance.clients(id) on delete cascade,
  -- Optional project pointer when the insight is project-specific.
  project_id      uuid references finance.projects(id) on delete set null,
  -- The kind of friction the brain detected.
  -- 'scope_creep' | 'revision_burden' | 'communication_lag' | 'rate_lag'
  -- | 'underpriced_relative_to_market' | 'overpriced_relative_to_outcomes'
  -- | 'time_spent_unaccounted' | 'general' — open text.
  kind            text not null,
  -- The AI-written observation, ≤ 60 words.
  observation     text not null,
  -- Loose jsonb context for audit + the future "why does it say that" path.
  context         jsonb not null default '{}'::jsonb,
  -- Hatim's reply that feeds the rate reasoning corpus.
  reply           text,
  replied_at      timestamptz,
  -- Optional suggested rate change (in client.default_currency or PHP).
  suggested_rate  numeric(14, 2),
  suggested_currency text,
  -- Whether the user has acted on it (raised the rate, sent a message,
  -- dismissed). Manual flag.
  acted           boolean not null default false,
  acted_at        timestamptz,
  generated_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists rate_insights_user_idx
  on finance.rate_insights (user_id, generated_at desc);

create index if not exists rate_insights_client_idx
  on finance.rate_insights (client_id, generated_at desc)
  where client_id is not null;

create trigger rate_insights_touch
  before update on finance.rate_insights
  for each row execute function finance.touch_updated_at();

alter table finance.rate_insights enable row level security;

create policy "owner_all" on finance.rate_insights
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
