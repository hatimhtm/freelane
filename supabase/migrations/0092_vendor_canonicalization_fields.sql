-- Freelane: vendor canonicalization fields (Vendors workflow).
--
-- The always-ask canonicalize-vendor brain (Pro) needs to remember the
-- raw text the user typed (vendor key for the cache), what canonical
-- name the brain proposed, the list of aliases the user has accepted
-- over time, when the last vendor_clarify notification fired (for the
-- 30-minute per-vendor debounce + 3/day cap), the brain's confidence,
-- and the brand_key the resolver should pin glyphs against.
--
-- brand_key is the column the 0084 backfill TODO flagged as planned for
-- migration 0086; the Brand Identity workflow's resolver
-- (resolveVendorIcon) reads this directly so the user's choice of
-- glyph survives independent of vendor_icon_cache.
--
-- All ADDs are idempotent: canonical_name already exists from 0032,
-- needs_identification + identification_skipped + last_identify_notif_at
-- ship in 0084. ALTER ADD COLUMN IF NOT EXISTS guards the rerun path.

alter table finance.vendors
  add column if not exists raw_user_typed_name text,
  add column if not exists aliases             jsonb       not null default '[]'::jsonb,
  add column if not exists last_clarify_notif_at timestamptz,
  add column if not exists confidence          numeric,
  add column if not exists brand_key           text;

-- Backfill raw_user_typed_name from canonical_name for every row that
-- pre-dates the always-ask flow. Once a vendor is canonicalized via the
-- brain the raw value is preserved separately; legacy rows treat the
-- canonical name as both source-of-truth and raw-typed.
update finance.vendors
  set raw_user_typed_name = canonical_name
  where raw_user_typed_name is null;

-- Brand-key backfill: vendor_icon_cache rows that flag the vendor as
-- identified (user_overridden or high-confidence) carry the canonical
-- glyph the resolver should display. Migrate that signal onto the
-- vendors row's brand_key so per-vendor reads no longer need to join
-- against vendor_icon_cache (and so the 0084 TODO is closed).
update finance.vendors v
  set brand_key = lower(regexp_replace(c.canonical_name, '\s+', '_', 'g'))
  from finance.vendor_icon_cache c
  where c.user_id = v.user_id
    and c.vendor_name_normalized = lower(regexp_replace(v.canonical_name, '\s+', '', 'g'))
    and v.brand_key is null
    and c.glyph_kind is not null
    and c.glyph_kind <> 'none';

comment on column finance.vendors.raw_user_typed_name is
  'The literal string the user typed when this vendor was first seen. The Pro canonicalize-vendor brain reads this verbatim; the canonical_name column captures the brain''s proposed clean form.';
comment on column finance.vendors.aliases is
  'JSON array of accepted alternate spellings ("Maeve''s", "Maeves"). The chatbot reply handler pushes the raw_user_typed_name here whenever the user confirms a canonical mapping.';
comment on column finance.vendors.last_clarify_notif_at is
  'Last time a vendor_clarify notification was dispatched for this vendor. 30-min per-vendor debounce floor; the 3/day global cap is enforced via countNotificationsInWindow on kind=vendor_clarify.';
comment on column finance.vendors.confidence is
  'Pro brain''s confidence in the canonical_name guess on the last run. NULL until the canonicalize-vendor brain has executed for this vendor.';
comment on column finance.vendors.brand_key is
  'Stable key the Brand Identity resolver uses to pin a glyph/colour pair. Persisted on vendors so the resolver does not have to round-trip vendor_icon_cache. Set by the chatbot clarify_vendor reply handler or by the brand resolver on first identification.';
