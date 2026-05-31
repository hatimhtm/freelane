-- Freelane: vendor identity layer.
--
-- Phase 1.5 used pure-text vendor extraction (src/lib/spending/vendor-extract.ts:
-- KNOWN_PH_VENDORS + a guess heuristic). Tier 2 promotes that to a canonical
-- `vendors` table so per-vendor heartbeat, price drift, vendor absence, and
-- the upcoming Vendor Identity Layer ("Places of San Pablo") have a stable
-- foreign key to hang notes, GPS, AI-curated memory off.
--
-- Three tables:
--   1. vendors            — canonical row per place. AI may suggest, user
--                           confirms. notes + memory_consolidated open the
--                           door to AI to write "Hatim ordered Lucky Me here
--                           the last 4 visits" without re-running extraction.
--   2. vendor_aliases     — alternative spellings that resolve to the canonical
--                           row ("mcdo" → McDonald's). Bootstrapped at first
--                           run from KNOWN_PH_VENDORS via a separate seed step
--                           in the application (not done in this migration —
--                           the lib already handles unseeded lookups).
--   3. spend_vendor_links — m2m, mirroring spend_category_links. A grocery
--                           run at SM that mentions a coffee bought next door
--                           can carry two vendors; same headline counting
--                           rule applies (per-vendor filters multi-count).
--
-- Why m2m (not a single vendor_id on spends): same reason category_id is m2m.
-- One spend can legitimately reference multiple vendors (the SM run that
-- included a Starbucks stop) and the AI consolidation works better when it
-- can read every vendor a spend touched.

create table if not exists finance.vendors (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  canonical_name       text not null,                     -- "SM Mayapa"
  slug                 text not null,                     -- "sm-mayapa"
  -- Free-form 1-line context the user adds. Different from notes (longer).
  short_description    text,
  -- Loose location data. Shape (loose, evolves):
  --   { area: "San Pablo", barangay?, gps?: { lat, lng }, landmark? }
  location             jsonb not null default '{}'::jsonb,
  -- Loose category tags for the vendor itself (NOT the spends through it).
  -- Helps the AI group "Mercury Drug" + "Watsons" as drug-store-like, etc.
  -- Possible values: 'grocery', 'food', 'fast_food', 'drug', 'tech', 'fuel',
  -- 'transit', 'household', 'clothing', 'service', 'utility'.
  kinds                jsonb not null default '[]'::jsonb,
  -- AI-consolidated memory mirroring user_memory / client_memory pattern.
  -- The brain summarizes spends linked to this vendor into a single doc.
  memory_consolidated  jsonb not null default '{}'::jsonb,
  notes                text,
  last_seen_at         date,                              -- cache of max(spent_at) for absence detection
  archived             boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (user_id, slug)
);

create index if not exists vendors_user_idx
  on finance.vendors (user_id)
  where archived = false;

create index if not exists vendors_last_seen_idx
  on finance.vendors (user_id, last_seen_at desc)
  where archived = false;

-- Trigram index on canonical_name + short_description for fuzzy lookups
-- ("did you mean SM Mayapa?" autocomplete).
create extension if not exists pg_trgm;

create index if not exists vendors_canonical_name_trgm_idx
  on finance.vendors using gin (canonical_name gin_trgm_ops);

create trigger vendors_touch
  before update on finance.vendors
  for each row execute function finance.touch_updated_at();

alter table finance.vendors enable row level security;

create policy "owner_all" on finance.vendors
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Aliases (alternative names that resolve to a canonical vendor) ──
create table if not exists finance.vendor_aliases (
  id           uuid primary key default gen_random_uuid(),
  vendor_id    uuid not null references finance.vendors(id) on delete cascade,
  alias        text not null,                              -- "mcdo", "the SM near the bus terminal"
  alias_norm   text not null,                              -- lowercase, stripped
  source       text not null default 'user',               -- 'user' | 'ai_suggest' | 'seed'
  created_at   timestamptz not null default now(),
  unique (vendor_id, alias_norm)
);

create index if not exists vendor_aliases_norm_idx
  on finance.vendor_aliases (alias_norm);

create index if not exists vendor_aliases_vendor_idx
  on finance.vendor_aliases (vendor_id);

alter table finance.vendor_aliases enable row level security;

-- RLS via parent vendor.
create policy "owner_via_vendor" on finance.vendor_aliases
  for all
  using (exists (select 1 from finance.vendors v where v.id = vendor_id and v.user_id = auth.uid()))
  with check (exists (select 1 from finance.vendors v where v.id = vendor_id and v.user_id = auth.uid()));

-- ── Spend ↔ Vendor m2m ──
create table if not exists finance.spend_vendor_links (
  spend_id   uuid not null references finance.spends(id) on delete cascade,
  vendor_id  uuid not null references finance.vendors(id) on delete cascade,
  -- Optional confidence: 'auto' (vendor extracted from description by the
  -- lib helper), 'user' (user explicitly tagged), 'ai_suggest' (Gemini
  -- proposed and waits for confirmation in ai_questions). 'auto' rows are
  -- the silent default and can be reclassified by the user without losing
  -- the spend tag.
  source     text not null default 'auto',
  created_at timestamptz not null default now(),
  primary key (spend_id, vendor_id)
);

create index if not exists spend_vendor_links_vendor_idx
  on finance.spend_vendor_links (vendor_id);

alter table finance.spend_vendor_links enable row level security;

create policy "owner_via_spend" on finance.spend_vendor_links
  for all
  using (exists (select 1 from finance.spends s where s.id = spend_id and s.user_id = auth.uid()))
  with check (exists (select 1 from finance.spends s where s.id = spend_id and s.user_id = auth.uid()));

-- ── Price drift observations (Tier 2: Price Drift Watch) ──
-- Lightweight log of "spend X cost Y at vendor Z on date D for item I". Reads
-- from spend_items.name + amount where vendor_id is set, plus a normalization
-- pass. Populated by the price-drift sweep, NOT by user UI. Used to detect
-- creeping increases over time at a specific vendor.
create table if not exists finance.price_drift_observations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  vendor_id    uuid references finance.vendors(id) on delete cascade,
  spend_id     uuid references finance.spends(id) on delete set null,
  item_name_norm  text not null,                          -- e.g. "milk 1l"
  unit_price_base numeric(14, 2) not null check (unit_price_base >= 0),
  -- The amount the user paid at this observation. May differ from
  -- unit_price_base if quantity > 1.
  paid_base    numeric(14, 2) not null check (paid_base >= 0),
  observed_at  date not null default current_date,
  created_at   timestamptz not null default now()
);

create index if not exists price_drift_user_item_idx
  on finance.price_drift_observations (user_id, item_name_norm, observed_at desc);

create index if not exists price_drift_vendor_item_idx
  on finance.price_drift_observations (vendor_id, item_name_norm, observed_at desc)
  where vendor_id is not null;

alter table finance.price_drift_observations enable row level security;

create policy "owner_all" on finance.price_drift_observations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
