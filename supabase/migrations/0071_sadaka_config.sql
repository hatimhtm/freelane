-- Freelane: Sadaka config (Phase 2 sadaka workflow).
--
-- Per-user knobs for the sadaka pool algorithm. Anchored on Islamic zakat
-- (2.5% base contribution rate) but lets the AI brain dampen / lift around
-- the anchor based on period stage, recent spend pattern, upcoming planned
-- outflows, and income volatility. Decay is the "old unpaid sadaka isn't
-- eternal debt" knob — relevance fades at 4%/month by default. The nudge
-- silence window keeps the inbox quiet between voluntary-give moments;
-- the classifier threshold gates AI-flagged auto_detected ledger rows
-- before they appear in Activity as tentative=true.
--
-- One row per user. Backfilled on signup via the auth.users insert trigger
-- and once for every existing user at apply time.

create table if not exists finance.sadaka_config (
  id                              uuid primary key default gen_random_uuid(),
  user_id                         uuid unique not null references auth.users(id) on delete cascade,
  base_contribution_pct           numeric not null default 2.5,
  decay_pct_monthly               numeric not null default 4,
  nudge_silence_days              int     not null default 5,
  classifier_confidence_threshold numeric not null default 0.7,
  updated_at                      timestamptz not null default now()
);

alter table finance.sadaka_config enable row level security;

create policy "sadaka_config_owner"
  on finance.sadaka_config
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Backfill defaults for every existing user. ON CONFLICT DO NOTHING keeps
-- this idempotent if the migration ever needs to be re-run.
insert into finance.sadaka_config (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- Auto-seed defaults on every new signup. SECURITY DEFINER so the trigger
-- runs with table-owner privileges and bypasses RLS at INSERT time. Search
-- path pinned so a search_path injection can't redirect the table reference.
create or replace function finance.sadaka_config_seed_for_user()
returns trigger
language plpgsql
security definer
set search_path = public, finance
as $$
begin
  insert into finance.sadaka_config (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists sadaka_config_seed_trg on auth.users;
create trigger sadaka_config_seed_trg
  after insert on auth.users
  for each row
  execute function finance.sadaka_config_seed_for_user();
