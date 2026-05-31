-- Freelane: milestones layer (Tier 3 — #11 Milestone Namer).
--
-- "Make as many of these as possible" — Hatim 2026-06-01. Dense crossings.
-- ₱100k month, 100th invoice, year smoke-free, 1st Sadaka, first loan closed,
-- 365 days of logging. Every meaningful threshold gets named.
--
-- kind values are intentionally text (not enum) — new milestone kinds get
-- added as the system grows ("first_macos_app_revenue", "first_eid_with_wife")
-- without alter-type pressure.
--
-- value is the numeric threshold crossed (e.g. 100000 for a ₱100k month).
-- nullable when the milestone is purely categorical (e.g. "first time").
--
-- narrative is the AI-written one-liner; the Milestone Namer brain writes
-- it on detection. Hatim can edit; UI surfaces it in the activity feed +
-- on Today when surfaced=true (24h freshness window).

create table if not exists finance.milestones (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null,                          -- 'peso_month_threshold' | 'invoice_count' | 'smoke_free_days' | 'loan_closed' | 'sadaka_total' | 'recurring_dropped' | 'wallet_filled' | etc
  label         text not null,                          -- "₱100k landed in May 2026"
  value         numeric(14, 2),                         -- 100000 (nullable for categorical)
  unit          text,                                   -- "PHP" | "invoices" | "days" | "spends" | etc
  -- Loose jsonb context the brain reads when narrating + the UI uses for
  -- linking back to the source.
  -- Shape varies per kind; examples:
  --   { period: "2026-05", source: "payments" }
  --   { loan_id, counterparty }
  --   { since_date: "2025-06-15", days: 365 }
  context       jsonb not null default '{}'::jsonb,
  narrative     text not null,                          -- AI-written, ≤ 20 words
  achieved_at   date not null default current_date,
  -- surfaced controls whether the milestone shows on Today (decays after
  -- 24h). Activity feed shows them regardless.
  surfaced      boolean not null default true,
  -- Hatim's reply note, same pattern as letters.reply.
  reply         text,
  replied_at    timestamptz,
  generated_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Dedupe per kind+period — a "₱100k month" milestone for "2026-05" is
  -- only ever written once.
  unique (user_id, kind, achieved_at, label)
);

create index if not exists milestones_user_idx
  on finance.milestones (user_id, achieved_at desc);

create index if not exists milestones_surfaced_idx
  on finance.milestones (user_id, achieved_at desc)
  where surfaced = true;

create trigger milestones_touch
  before update on finance.milestones
  for each row execute function finance.touch_updated_at();

alter table finance.milestones enable row level security;

create policy "owner_all" on finance.milestones
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
