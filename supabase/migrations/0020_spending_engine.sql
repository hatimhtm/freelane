-- Freelane: spending engine — categories (multi-tag), spends, optional items
-- with VAT, recurring expectations with pre-payment support, personal loans
-- with installment plans, and the AI's running notebook on the user.
--
-- Why one big migration: every spend has to reference a wallet, recurring rules
-- and loan installments both materialize as spends when marked paid, and the
-- AI snapshot has to read all of it. Shipping them split would mean reworking
-- the safe-to-spend math + the AI snapshot twice.
--
-- The deliberate accounting choices (mirroring the income-side rules):
--  - Spend amount_base is LOCKED at entry time via today's FX. Past spends never
--    re-float with the market — same immutability rule as paid payments.
--  - Recurring rules are EDITABLE (rent changes when you move house); past spends
--    keep the exact amount you actually paid.
--  - Categories are TAGS, many-per-spend. One ₱2,500 laptop tagged
--    Tech + Investment + Wife counts as ₱2,500 in the headline total exactly
--    once. Per-category filters sum any spend tagged with that category —
--    so the same spend appears under all 3 filters.
--  - business_relevant flag (not a category) lets the AI distinguish personal
--    vs business outflows without splitting the ledger into two spaces.
--  - "Forgotten" is a real category, not a missing value. You're allowed to
--    not remember where money went.
--  - Sadaka is a category, NOT a target — the AI suggests amounts contextually
--    at each income event based on the moment's financial situation.

-- ── 1. Drop the unused expenses table ─────────────────────────────────────
-- Originally added in 0009 but never wired into UI; deliberately excluded per
-- the README's "no expenses" rule. Spending now supersedes it.
drop table if exists finance.expenses cascade;

-- ── 2. Expand the holding-wallet pool ─────────────────────────────────────
-- Cash + coin.ph were already is_holding via 0018. GCash + Wise become holding
-- too (you keep running balances there), and the legacy "Bank wire — primary"
-- gets renamed to "Bank account" + flagged holding. Anything the user flags
-- later via Settings automatically joins the holding pool — these are seeds.
update finance.payment_methods
   set is_holding = true,
       kind = case when kind in ('bank', 'cash') then kind else 'wallet'::finance.payment_method_kind end
 where lower(name) in ('gcash', 'wise');

update finance.payment_methods
   set name       = 'Bank account',
       is_holding = true,
       kind       = 'bank',
       notes      = coalesce(notes, '') ||
                    case when notes is null or notes = '' then ''
                         else E'\n\n' end ||
                    'Renamed from "Bank wire — primary" in migration 0020. Balance-carrying wallet now.'
 where name = 'Bank wire — primary';

-- ── 3. Spend categories (per-user, taggable) ──────────────────────────────
create table if not exists finance.spend_categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  icon        text,
  color       text,
  sort_order  integer not null default 0,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists spend_categories_user_idx
  on finance.spend_categories (user_id)
  where archived = false;

create trigger spend_categories_touch
  before update on finance.spend_categories
  for each row execute function finance.touch_updated_at();

alter table finance.spend_categories enable row level security;

create policy "owner_all" on finance.spend_categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Seed default categories for every existing user. Ordered roughly by expected
-- frequency-of-use; user can rename, recolor, reorder, archive any of them.
insert into finance.spend_categories (user_id, name, sort_order)
select s.user_id, c.name, c.sort_order
from finance.settings s
cross join (values
  ('Groceries',         10),
  ('Fast food',         20),
  ('Ordering food',     30),
  ('Cooking',           40),
  ('Transportation',    50),  -- jeep / tricycle / Grab / etc.
  ('Wife',              60),
  ('Cigarettes',        70),
  ('Health',            80),
  ('Travel',            90),
  ('Tech',             100),
  ('Investment',       110),  -- "the laptop pays back 20×" kind, not stock-market kind
  ('Rent',             120),
  ('Wifi / Bills',     130),
  ('Loan repayment',   140),  -- friend/family money returned
  ('Sadaka',           150),  -- charity; AI suggests amounts per income event
  ('Forgotten',        900),  -- the "I don't remember where this went" fallback
  ('Other',            999)
) as c(name, sort_order)
on conflict (user_id, name) do nothing;

-- ── 4. Recurring spends (schedules — rent, wifi, dev subs…) ───────────────
-- A user-defined expectation: rent ≈ ₱3500 around the 5th, wifi ≈ ₱700 around
-- the 15th. The rule is editable — change the amount when you move house; past
-- spends keep their actual paid amount (immutable history). When you mark a
-- recurring "paid" in its window, a real spends row is pre-filled with the
-- expected_amount + default categories and you confirm before save.
create type finance.recurring_schedule_kind as enum (
  'weekly',          -- every N weeks, on day_of_week
  'half_monthly',    -- the 1st AND the 15th of each month
  'monthly',         -- once a month, on day_of_month
  'every_n_months',  -- every N months, on day_of_month
  'yearly'           -- once a year (Apple Developer subscription kind)
);

create table if not exists finance.recurring_spends (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  wallet_id             uuid references finance.payment_methods(id) on delete set null,
  label                 text not null,                -- "Rent", "Wifi", "Apple Developer"
  expected_amount       numeric(14, 2) not null check (expected_amount > 0),
  expected_currency     text not null references finance.currencies(code),
  schedule_kind         finance.recurring_schedule_kind not null default 'monthly',
  day_of_month          integer check (day_of_month between 1 and 31),
  day_of_week           integer check (day_of_week between 0 and 6),  -- 0 = Sunday
  every_n_value         integer check (every_n_value >= 1),           -- N for weekly / every_n_months
  window_before_days    integer not null default 3 check (window_before_days >= 0),
  window_after_days     integer not null default 3 check (window_after_days >= 0),
  default_category_ids  jsonb not null default '[]'::jsonb,
  business_relevant     boolean not null default false,
  active                boolean not null default true,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists recurring_spends_user_active_idx
  on finance.recurring_spends (user_id)
  where active = true;

create trigger recurring_spends_touch
  before update on finance.recurring_spends
  for each row execute function finance.touch_updated_at();

alter table finance.recurring_spends enable row level security;

create policy "owner_all" on finance.recurring_spends
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 5. Loans (personal — friend/family, NOT bank) ─────────────────────────
-- Direction = borrowed | lent. A repayment plan attaches as installments so the
-- safe-to-spend formula sees what's due this month. Each paid installment
-- materializes as a spends row (for borrowed) tagged "Loan repayment".
create type finance.loan_direction as enum ('borrowed', 'lent');
create type finance.loan_status    as enum ('open', 'partial', 'closed');

create table if not exists finance.loans (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  counterparty        text not null,
  direction           finance.loan_direction not null,
  principal_amount    numeric(14, 2) not null check (principal_amount > 0),
  principal_currency  text not null references finance.currencies(code),
  principal_base      numeric(14, 2) not null check (principal_base >= 0),  -- PHP equiv locked
  borrowed_at         date not null default current_date,
  expected_return_by  date,
  status              finance.loan_status not null default 'open',
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists loans_user_status_idx on finance.loans (user_id, status);

create trigger loans_touch
  before update on finance.loans
  for each row execute function finance.touch_updated_at();

alter table finance.loans enable row level security;

create policy "owner_all" on finance.loans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Installment plan rows. spend_id FK is added AFTER the spends table exists
-- below (back-edge — installments reference paid spends, spends reference the
-- installment they paid off, neither table can come first cleanly).
create type finance.loan_installment_status as enum ('pending', 'paid', 'skipped');

create table if not exists finance.loan_installments (
  id                uuid primary key default gen_random_uuid(),
  loan_id           uuid not null references finance.loans(id) on delete cascade,
  due_date          date not null,
  expected_amount   numeric(14, 2) not null check (expected_amount > 0),
  expected_currency text not null references finance.currencies(code),
  status            finance.loan_installment_status not null default 'pending',
  spend_id          uuid,                                    -- FK wired below
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists loan_installments_pending_due_idx
  on finance.loan_installments (loan_id, due_date)
  where status = 'pending';

create trigger loan_installments_touch
  before update on finance.loan_installments
  for each row execute function finance.touch_updated_at();

alter table finance.loan_installments enable row level security;

-- RLS via parent loan ownership.
create policy "owner_via_loan" on finance.loan_installments
  for all
  using (exists (select 1 from finance.loans l where l.id = loan_id and l.user_id = auth.uid()))
  with check (exists (select 1 from finance.loans l where l.id = loan_id and l.user_id = auth.uid()));

-- ── 6. Spends (the headline table) ────────────────────────────────────────
-- Currency-flexible (USD Apple sub, MAD travel goods, PHP day-to-day). The
-- amount_base column locks the PHP equivalent at entry time via today's FX —
-- same immutability principle as payments.net_amount_base. Past spends never
-- re-float with the market.
--
-- covers_periods >= 1 lets ONE row settle multiple recurring periods
-- (pre-paid 3 months of wifi at once = covers_periods=3). The recurring engine
-- emits skip rows for the remaining N-1 periods so reminders stay quiet.
--
-- Loan repayments support BOTH paths:
--  - Lump sum: just set loan_id; loan auto-closes when sum of repayments ≥ principal.
--  - Installment plan: set loan_installment_id (loan_id may also be set for
--    convenience but the installment is the source of truth).
-- Most personal loans are one-shot lump sums; installments are the exception.
--
-- spent_at accepts any date — backfilling historical spends is a first-class
-- workflow, not a special mode. amount_base is computed via FX at LOG time
-- (not at spent_at time) so the locked PHP equivalent reflects what the user
-- saw when they logged it, even for backdated entries.
create table if not exists finance.spends (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  wallet_id            uuid not null references finance.payment_methods(id) on delete restrict,
  spent_at             date not null default current_date,
  amount               numeric(14, 2) not null check (amount > 0),
  currency             text not null references finance.currencies(code),
  amount_base          numeric(14, 2) not null check (amount_base >= 0),
  description          text,
  notes                text,
  vat_amount           numeric(14, 2),                       -- optional, denominated in `currency`
  business_relevant    boolean not null default false,
  covers_periods       integer not null default 1 check (covers_periods >= 1),
  recurring_spend_id   uuid references finance.recurring_spends(id) on delete set null,
  loan_id              uuid references finance.loans(id) on delete set null,
  loan_installment_id  uuid references finance.loan_installments(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists spends_user_date_idx        on finance.spends (user_id, spent_at desc);
create index if not exists spends_wallet_idx           on finance.spends (wallet_id);
create index if not exists spends_recurring_idx        on finance.spends (recurring_spend_id) where recurring_spend_id is not null;
create index if not exists spends_loan_idx             on finance.spends (loan_id) where loan_id is not null;
create index if not exists spends_loan_installment_idx on finance.spends (loan_installment_id) where loan_installment_id is not null;
create index if not exists spends_business_idx        on finance.spends (user_id, spent_at desc) where business_relevant = true;

create trigger spends_touch
  before update on finance.spends
  for each row execute function finance.touch_updated_at();

alter table finance.spends enable row level security;

create policy "owner_all" on finance.spends
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Now wire the loan_installments → spends back-edge.
alter table finance.loan_installments
  add constraint loan_installments_spend_fk
  foreign key (spend_id) references finance.spends(id) on delete set null;

-- ── 7. Spend ↔ Categories (m2m tags) ──────────────────────────────────────
-- A spend can carry multiple tags. The monthly headline TOTAL counts each
-- spend ONCE (sum on spends.amount_base). Per-category filters sum ANY spend
-- tagged with that category — so a spend tagged with N categories shows up
-- under N filters (deliberate; lets you see "everything tagged Investment"
-- including dual-tag rows like the Tech+Investment laptop).
create table if not exists finance.spend_category_links (
  spend_id    uuid not null references finance.spends(id) on delete cascade,
  category_id uuid not null references finance.spend_categories(id) on delete cascade,
  primary key (spend_id, category_id)
);

create index if not exists spend_category_links_cat_idx
  on finance.spend_category_links (category_id);

alter table finance.spend_category_links enable row level security;

create policy "owner_via_spend" on finance.spend_category_links
  for all
  using (exists (select 1 from finance.spends s where s.id = spend_id and s.user_id = auth.uid()))
  with check (exists (select 1 from finance.spends s where s.id = spend_id and s.user_id = auth.uid()));

-- ── 8. Spend items (sparse, optional sub-rows) ────────────────────────────
-- User enters items AFTER picking categories on the entry sheet, and can skip
-- entirely — the spend just lives under the top-level tags. VAT can be set
-- per-item or on the parent spend (or both). Amount nullable so you can list
-- items by name without remembering exact prices.
create table if not exists finance.spend_items (
  id          uuid primary key default gen_random_uuid(),
  spend_id    uuid not null references finance.spends(id) on delete cascade,
  name        text not null,
  amount      numeric(14, 2) check (amount is null or amount >= 0),
  vat_amount  numeric(14, 2),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists spend_items_spend_idx on finance.spend_items (spend_id, sort_order);

alter table finance.spend_items enable row level security;

create policy "owner_via_spend" on finance.spend_items
  for all
  using (exists (select 1 from finance.spends s where s.id = spend_id and s.user_id = auth.uid()))
  with check (exists (select 1 from finance.spends s where s.id = spend_id and s.user_id = auth.uid()));

-- ── 9. Recurring spend skips (explicit "this period handled") ─────────────
-- The Today screen reads pending = (current date inside the rule's window) AND
-- (no spends row exists with recurring_spend_id = this rule for the period)
-- AND (no skip row exists for the period). A skip can be user-initiated
-- ("skip this month") OR auto-emitted by a pre-payment (covers_periods > 1
-- writes N-1 skips marking the future periods as already covered).
--
-- period_key format (consistent across schedules):
--   monthly         → "YYYY-MM"        e.g. "2026-05"
--   half_monthly    → "YYYY-MM-H1" or  "YYYY-MM-H2"
--   weekly          → "YYYY-Www"       e.g. "2026-W22"
--   every_n_months  → "YYYY-MM"
--   yearly          → "YYYY"
create type finance.recurring_skip_source as enum ('user_skip', 'covered_by_prepay');

create table if not exists finance.recurring_spend_skips (
  recurring_spend_id  uuid not null references finance.recurring_spends(id) on delete cascade,
  period_key          text not null,
  source              finance.recurring_skip_source not null default 'user_skip',
  spend_id            uuid references finance.spends(id) on delete set null,
  notes               text,
  created_at          timestamptz not null default now(),
  primary key (recurring_spend_id, period_key)
);

alter table finance.recurring_spend_skips enable row level security;

create policy "owner_via_recurring" on finance.recurring_spend_skips
  for all
  using (exists (select 1 from finance.recurring_spends r where r.id = recurring_spend_id and r.user_id = auth.uid()))
  with check (exists (select 1 from finance.recurring_spends r where r.id = recurring_spend_id and r.user_id = auth.uid()));

-- ── 10. User memory (AI's running notebook on the user) ───────────────────
-- Mirrors the client memory pattern (migration 0012): raw observations
-- accumulate in entries, Gemini periodically folds them into a single
-- consolidated doc on user_memory.memory_consolidated. The AI seeds itself
-- from this snapshot every call — graceful with sparse data (cold start
-- logs "still learning, 3 spends seen so far" observations until patterns
-- emerge). This is what powers "the model grows with use".
--
-- memory_consolidated shape (loose, evolves):
--   { summary, patterns: [], watch: [], preferences: {}, milestones: [],
--     last_seeded_at, entry_count }
create table if not exists finance.user_memory (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  memory_consolidated  jsonb not null default '{}'::jsonb,
  entry_count          integer not null default 0,
  updated_at           timestamptz not null default now()
);

alter table finance.user_memory enable row level security;
create policy "owner_all" on finance.user_memory
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Sources:
--   observation — AI noticed something ("user logged 4 grocery runs this week")
--   user_note   — the user wrote a note ("I'm trying to cook more")
--   insight     — a Gemini-generated insight kept as a persistent fact
create type finance.user_memory_source as enum ('observation', 'user_note', 'insight');

create table if not exists finance.user_memory_entries (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  content         text not null,
  source          finance.user_memory_source not null default 'observation',
  created_at      timestamptz not null default now(),
  consolidated_at timestamptz
);

create index if not exists user_memory_entries_user_idx
  on finance.user_memory_entries (user_id, created_at desc);

alter table finance.user_memory_entries enable row level security;
create policy "owner_all" on finance.user_memory_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
