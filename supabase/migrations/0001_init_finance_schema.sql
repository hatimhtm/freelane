-- Freelane: initial schema
-- Creates an isolated `finance` schema so it coexists with anything already in `public`.
-- Single-user app but designed multi-user-ready: every row is scoped by user_id + RLS.

create schema if not exists finance;
grant usage on schema finance to anon, authenticated;

create extension if not exists "pgcrypto";

-- ───────────────────────────────────────────────────────────────────
-- Currencies (global reference) + per-user exchange rates to base
-- ───────────────────────────────────────────────────────────────────
create table finance.currencies (
  code        text primary key,
  name        text not null,
  symbol      text,
  created_at  timestamptz not null default now()
);

insert into finance.currencies (code, name, symbol) values
  ('PHP', 'Philippine Peso',  '₱'),
  ('MAD', 'Moroccan Dirham',  'MAD'),
  ('USD', 'US Dollar',        '$'),
  ('EUR', 'Euro',             '€'),
  ('CNY', 'Chinese Yuan',     '¥');

create table finance.exchange_rates (
  user_id       uuid not null references auth.users(id) on delete cascade,
  code          text not null references finance.currencies(code) on update cascade,
  rate_to_base  numeric(18, 8) not null check (rate_to_base > 0),
  updated_at    timestamptz not null default now(),
  primary key (user_id, code)
);

-- ───────────────────────────────────────────────────────────────────
-- Settings (one row per user; holds issuer profile + app defaults)
-- ───────────────────────────────────────────────────────────────────
create table finance.settings (
  user_id                  uuid primary key references auth.users(id) on delete cascade,
  base_currency            text not null default 'PHP' references finance.currencies(code),
  issuer_name              text,
  issuer_role              text,
  issuer_address           text,
  issuer_phone             text,
  issuer_email             text,
  issuer_cin               text,
  invoice_number_format    text not null default 'YYYY-NNN',
  invoice_tva_note         text default 'TVA non applicable (Freelance sans statut)',
  invoice_show_tva_note    boolean not null default true,
  invoice_footer           text default 'Merci pour votre confiance !',
  invoice_accent_color     text default '#2c3e50',
  invoice_language         text not null default 'fr',
  theme                    text not null default 'system',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- ───────────────────────────────────────────────────────────────────
-- Clients (invoice presets: name, address, ICE, RC, bank info)
-- ───────────────────────────────────────────────────────────────────
create table finance.clients (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  name              text not null,
  company           text,
  address           text,
  city              text,
  country           text,
  ice               text,
  rc                text,
  tax_id            text,
  bank_name         text,
  bank_account      text,
  iban              text,
  swift             text,
  email             text,
  phone             text,
  default_currency  text references finance.currencies(code),
  accent_color      text,
  notes             text,
  archived          boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index clients_user_idx on finance.clients (user_id) where archived = false;

-- ───────────────────────────────────────────────────────────────────
-- Categories (job types per client — e.g. "iOS Dev", "Consultation")
-- ───────────────────────────────────────────────────────────────────
create table finance.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  client_id  uuid references finance.clients(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

create index categories_client_idx on finance.categories (client_id);

-- ───────────────────────────────────────────────────────────────────
-- Projects (= jobs)
-- ───────────────────────────────────────────────────────────────────
create type finance.project_status as enum (
  'quoted', 'in_progress', 'invoiced', 'partially_paid', 'paid', 'overdue', 'archived'
);

create table finance.projects (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  client_id        uuid not null references finance.clients(id) on delete cascade,
  category_id      uuid references finance.categories(id) on delete set null,
  title            text not null,
  description      text,
  amount           numeric(14, 2) not null default 0 check (amount >= 0),
  currency         text not null references finance.currencies(code),
  status           finance.project_status not null default 'quoted',
  kanban_position  numeric not null default 0,
  quoted_at        date default current_date,
  due_date         date,
  completed_at     date,
  tags             text[] not null default '{}',
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index projects_user_status_idx on finance.projects (user_id, status);
create index projects_client_idx      on finance.projects (client_id);

-- ───────────────────────────────────────────────────────────────────
-- Payments (partial-payment log → drives project status)
-- ───────────────────────────────────────────────────────────────────
create table finance.payments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  project_id  uuid not null references finance.projects(id) on delete cascade,
  amount      numeric(14, 2) not null check (amount > 0),
  currency    text not null references finance.currencies(code),
  paid_at     date not null default current_date,
  method      text,
  reference   text,
  notes       text,
  created_at  timestamptz not null default now()
);

create index payments_project_idx on finance.payments (project_id);

-- ───────────────────────────────────────────────────────────────────
-- Invoices (snapshots issuer + client at issue time so history is stable)
-- ───────────────────────────────────────────────────────────────────
create type finance.invoice_status as enum ('draft', 'issued', 'sent', 'paid', 'void');

create table finance.invoices (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  client_id         uuid not null references finance.clients(id) on delete cascade,
  invoice_number    text not null,
  issue_date        date not null default current_date,
  due_date          date,
  currency          text not null references finance.currencies(code),
  status            finance.invoice_status not null default 'draft',
  issuer_snapshot   jsonb not null,
  client_snapshot   jsonb not null,
  line_items        jsonb not null default '[]'::jsonb,
  subtotal          numeric(14, 2) not null default 0,
  tva_rate          numeric(5, 2) not null default 0,
  tva_amount        numeric(14, 2) not null default 0,
  total             numeric(14, 2) not null default 0,
  show_tva_note     boolean not null default true,
  tva_note          text,
  footer            text,
  notes             text,
  language          text not null default 'fr',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, invoice_number)
);

create index invoices_client_idx on finance.invoices (client_id);

create table finance.invoice_projects (
  invoice_id  uuid not null references finance.invoices(id) on delete cascade,
  project_id  uuid not null references finance.projects(id) on delete cascade,
  primary key (invoice_id, project_id)
);

-- ───────────────────────────────────────────────────────────────────
-- updated_at auto-refresh trigger
-- ───────────────────────────────────────────────────────────────────
create or replace function finance.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger settings_touch      before update on finance.settings      for each row execute function finance.touch_updated_at();
create trigger clients_touch       before update on finance.clients       for each row execute function finance.touch_updated_at();
create trigger projects_touch      before update on finance.projects      for each row execute function finance.touch_updated_at();
create trigger invoices_touch      before update on finance.invoices      for each row execute function finance.touch_updated_at();
create trigger exchange_rates_touch before update on finance.exchange_rates for each row execute function finance.touch_updated_at();

-- ───────────────────────────────────────────────────────────────────
-- Row-Level Security — every user-scoped table locks to auth.uid()
-- ───────────────────────────────────────────────────────────────────
alter table finance.exchange_rates    enable row level security;
alter table finance.settings          enable row level security;
alter table finance.clients           enable row level security;
alter table finance.categories        enable row level security;
alter table finance.projects          enable row level security;
alter table finance.payments          enable row level security;
alter table finance.invoices          enable row level security;
alter table finance.invoice_projects  enable row level security;
alter table finance.currencies        enable row level security;

-- Currencies is a global reference — everyone reads, nobody writes from client.
create policy "currencies_read" on finance.currencies
  for select using (true);

-- Generic owner-only policy for user-scoped tables.
create policy "owner_all" on finance.exchange_rates
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "owner_all" on finance.settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "owner_all" on finance.clients
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "owner_all" on finance.categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "owner_all" on finance.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "owner_all" on finance.payments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "owner_all" on finance.invoices
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Join table: access if you own the parent invoice
create policy "owner_via_invoice" on finance.invoice_projects
  for all using (
    exists (select 1 from finance.invoices i where i.id = invoice_id and i.user_id = auth.uid())
  ) with check (
    exists (select 1 from finance.invoices i where i.id = invoice_id and i.user_id = auth.uid())
  );

-- ───────────────────────────────────────────────────────────────────
-- View: project totals + status derivation (sum of payments, balance)
-- ───────────────────────────────────────────────────────────────────
create or replace view finance.project_totals as
select
  p.id                                                  as project_id,
  p.user_id,
  p.amount                                              as total_amount,
  p.currency,
  coalesce(sum(pay.amount) filter (
    where pay.currency = p.currency                     -- only sum same-currency payments
  ), 0)                                                 as total_paid,
  p.amount - coalesce(sum(pay.amount) filter (
    where pay.currency = p.currency
  ), 0)                                                 as outstanding
from finance.projects p
left join finance.payments pay on pay.project_id = p.id
group by p.id;

-- Expose finance schema to PostgREST (so supabase-js can query it).
-- Run this separately in the Dashboard → Settings → API → "Exposed schemas"
-- if the line below doesn't take effect automatically.
comment on schema finance is 'Freelane app — exposed to PostgREST';
