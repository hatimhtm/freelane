-- Freelane: Faith subtab — per-user prayer-times + qibla + Hijri config.
--
-- One row per user_id (PK = user_id). Stores:
--   latitude / longitude          — for prayer-types API + qibla bearing
--   calculation_method            — aladhan numeric method whitelist; 2 (ISNA)
--                                   is a safe global default. The whitelist
--                                   skips 6 and 7 because aladhan reserves
--                                   them for institution-only methods that
--                                   silently fall back on the public API
--                                   rather than error.
--   madhab                        — 'shafi' | 'hanafi' (asr-shadow rule)
--   ramadan_enabled               — show iftar/suhoor tiles on the Faith page
--                                   during the Hijri month of Ramadan. Today's
--                                   own Ramadan banner is driven separately
--                                   off islamic_calendar (the Hijri-month
--                                   detector), so this flag does NOT change
--                                   what Today shows.
--
-- The aladhan API call lives in the Next.js cache (see
-- src/lib/faith/prayer-times.ts). The fetch URL embeds (lat, lng, date,
-- method, madhab) and the response is shared via a single
-- 'freelane-faith-prayer-times' cache tag — saveFaithSettings flushes the
-- tag on every write, so the next render fetches fresh data even though
-- the OLD URL stays in the per-key cache.
--
-- Owner-only RLS — every read/write goes through the row owner's auth.uid().
-- A touch-updated_at trigger keeps updated_at in sync without app-layer
-- bookkeeping.

create table if not exists finance.faith_settings (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  latitude             numeric(9, 6),
  longitude            numeric(9, 6),
  calculation_method   smallint not null default 2
    check (calculation_method in (0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15)),
  madhab               text not null default 'shafi'
    check (madhab in ('shafi', 'hanafi')),
  ramadan_enabled      boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table finance.faith_settings enable row level security;

create policy "owner_all" on finance.faith_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function finance.tg_faith_settings_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists faith_settings_touch on finance.faith_settings;

create trigger faith_settings_touch
  before update on finance.faith_settings
  for each row execute function finance.tg_faith_settings_touch_updated_at();
