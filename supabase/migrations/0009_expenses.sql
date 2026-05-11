-- Freelane: expenses tracking
--
-- The tagline says "Track every freelance coin" but 1.x only tracked income.
-- This adds a simple expenses table — date, description, amount, currency,
-- optional vendor, optional category, optional notes. No invoicing tie-in;
-- expenses are independent of projects.
--
-- Conventions match finance.payments: numeric(14,2), currency FK, RLS by
-- user_id, owner_all policy, created/updated timestamps.

create table if not exists finance.expenses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  spent_at    date not null default current_date,
  description text not null,
  amount      numeric(14, 2) not null check (amount > 0),
  currency    text not null references finance.currencies(code),
  category    text,
  vendor      text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists expenses_user_date_idx on finance.expenses (user_id, spent_at desc);

alter table finance.expenses enable row level security;

create policy "owner_all" on finance.expenses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- updated_at trigger (same pattern as other tables)
create or replace function finance.touch_expenses_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger expenses_updated_at
  before update on finance.expenses
  for each row execute function finance.touch_expenses_updated_at();
