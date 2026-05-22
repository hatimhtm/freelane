-- Freelane: cache for the "Today's Focus" AI card.
--
-- One row per user. Stores the last-generated insights + when. The Today page
-- reads this instantly; it regenerates on demand (button) or when the cache is
-- older than 24h (checked client-side on open) — so Gemini isn't re-billed on
-- every page load.

create table if not exists finance.ai_focus_cache (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  insights     jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now()
);

alter table finance.ai_focus_cache enable row level security;

create policy "owner_all" on finance.ai_focus_cache
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
