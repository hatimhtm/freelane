-- Freelane: quiet receipts (Tier 3 — #13).
--
-- Small good things get one-line receipts. Loan repaid. Recurring rule
-- lowered. Sadaka given. First withdrawal off a coin.ph balance. The
-- difference between Milestone Namer and Quiet Receipts:
--   - Milestone = a CROSSING (threshold reached for the first time, or
--     the Nth time on a counted scale).
--   - Quiet Receipt = a HABIT or ACTION acknowledged (the action itself
--     is the receipt; no threshold required).
--
-- Both surfaces feel observational, not congratulatory. Quiet Receipts are
-- meant to feel like a footnote in the day — "you closed Tito's loan",
-- not "great job!".

create table if not exists finance.quiet_receipts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null,                          -- 'loan_repaid' | 'recurring_lowered' | 'recurring_paused' | 'sadaka_given' | 'first_withdrawal' | 'invoice_sent' | 'plan_committed' | etc
  source_entity_type text,                              -- 'loan' | 'recurring_spend' | 'spend' | 'planned_spend' | 'payment' | etc
  source_entity_id   uuid,                              -- weak FK, nullable
  narrative     text not null,                          -- AI-written, 10-22 words
  -- Loose jsonb context.
  context       jsonb not null default '{}'::jsonb,
  occurred_at   date not null default current_date,
  -- Reply pattern.
  reply         text,
  replied_at    timestamptz,
  generated_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists quiet_receipts_user_idx
  on finance.quiet_receipts (user_id, occurred_at desc);

create index if not exists quiet_receipts_source_idx
  on finance.quiet_receipts (source_entity_type, source_entity_id)
  where source_entity_id is not null;

create trigger quiet_receipts_touch
  before update on finance.quiet_receipts
  for each row execute function finance.touch_updated_at();

alter table finance.quiet_receipts enable row level security;

create policy "owner_all" on finance.quiet_receipts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
