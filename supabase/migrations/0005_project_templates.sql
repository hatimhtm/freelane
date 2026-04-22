-- Freelane: project templates. Save a recurring project shape (title,
-- description, amount, currency, tags, optional client) and apply it when
-- creating a new project to skip repetitive typing.

create table if not exists finance.project_templates (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  name                text not null,
  title_template      text,
  description_template text,
  default_amount      numeric(14, 2),
  default_currency    text references finance.currencies(code),
  default_client_id   uuid references finance.clients(id) on delete set null,
  default_tags        text[] not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists project_templates_user_idx
  on finance.project_templates (user_id);

create trigger project_templates_touch
  before update on finance.project_templates
  for each row execute function finance.touch_updated_at();

alter table finance.project_templates enable row level security;

create policy "owner_all" on finance.project_templates
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
