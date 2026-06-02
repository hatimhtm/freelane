-- Freelane: vendor_icon_cache (Brand Identity workflow).
--
-- The three-tier vendor icon resolver:
--   1. curated PH vendor registry (src/lib/brand/vendors.ts)
--   2. AI-fetched fallback brain (identify-vendor — Flash Lite, write-once)
--   3. generic paper-tile + initial fallback
--
-- This table stores tier-2 results so the brain runs once per
-- vendor_name_normalized per user, not on every render. Low-confidence
-- (<0.4) writes glyph_kind='none' so the brain is never re-asked for that
-- normalized name — the resolver simply falls through to tier 3.
--
-- user_overridden flips true when the user picks a glyph/color manually
-- (per-vendor edit-icon control in vendor detail). The resolver respects
-- this forever — the brain never overwrites a user choice.

create table if not exists finance.vendor_icon_cache (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete cascade,
  vendor_name_normalized  text not null,
  canonical_name          text,
  brand_color_hex         text,
  glyph_kind              text not null check (glyph_kind in ('letter','symbol','category','none')),
  glyph_value             text,
  category_hint           text,
  confidence              numeric,
  generated_at            timestamptz not null default now(),
  user_overridden         boolean not null default false,
  unique (user_id, vendor_name_normalized)
);

comment on table finance.vendor_icon_cache is
  'Per-user cache for the vendor icon resolver (tier 2: AI-identified). Write-once per vendor_name_normalized. user_overridden forever-respected.';

create index if not exists vendor_icon_cache_user_idx
  on finance.vendor_icon_cache(user_id);

alter table finance.vendor_icon_cache enable row level security;

create policy "vendor_icon_cache_owner_select"
  on finance.vendor_icon_cache
  for select
  using (auth.uid() = user_id);

create policy "vendor_icon_cache_owner_insert"
  on finance.vendor_icon_cache
  for insert
  with check (auth.uid() = user_id);

create policy "vendor_icon_cache_owner_update"
  on finance.vendor_icon_cache
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "vendor_icon_cache_owner_delete"
  on finance.vendor_icon_cache
  for delete
  using (auth.uid() = user_id);
