-- Freelane: life shifts log (Tier 3 — #14 What Changed).
--
-- Hatim moved house → rent shifted from ₱3,500 to ₱4,200. A recurring rule
-- got paused (gym membership dropped). A new currency entered (KRW from a
-- Korean client). A wallet was added. These are LIFE INFLECTIONS, not
-- transactions. They get logged here with a paragraph + date so the Year
-- Letter, the End-of-Month Letter, and the Anniversary Witness all have a
-- stitched narrative to pull from.
--
-- kind values:
--   rent_changed        — wife pays own tuition / Hatim moved / rent rule updated
--   recurring_added     — new recurring rule
--   recurring_paused    — rule went inactive
--   recurring_changed   — amount changed materially (> 15%)
--   currency_entered    — first payment in a previously-unseen currency
--   wallet_added        — new payment method becomes a holding wallet
--   wallet_negative     — wallet first went into negative territory
--   loan_taken          — borrowed
--   loan_closed         — loan settled to zero
--   plan_committed      — big plan locked
--   plan_done           — big plan materialized
--   ... (open-ended; text not enum)
--
-- Most kinds are auto-detected from mutations by the What Changed writer;
-- some can be added manually via /letters → What Changed tab.

create table if not exists finance.life_shifts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  kind           text not null,
  label          text not null,                         -- "Rent shifted ₱3,500 → ₱4,200"
  before_value   text,                                   -- "₱3,500" — free-form
  after_value    text,                                   -- "₱4,200"
  -- Source pointer (weak FK).
  source_entity_type text,
  source_entity_id   uuid,
  narrative      text not null,                          -- AI-written paragraph
  -- Loose jsonb context.
  context        jsonb not null default '{}'::jsonb,
  occurred_at    date not null default current_date,
  -- Reply pattern.
  reply          text,
  replied_at     timestamptz,
  generated_at   timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists life_shifts_user_idx
  on finance.life_shifts (user_id, occurred_at desc);

create index if not exists life_shifts_source_idx
  on finance.life_shifts (source_entity_type, source_entity_id)
  where source_entity_id is not null;

create trigger life_shifts_touch
  before update on finance.life_shifts
  for each row execute function finance.touch_updated_at();

alter table finance.life_shifts enable row level security;

create policy "owner_all" on finance.life_shifts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
