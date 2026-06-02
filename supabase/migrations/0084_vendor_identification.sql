-- Freelane: vendor identification state (Spendings workflow).
--
-- New flow on unknown-vendor spend logging:
--   1. createSpend / createVendor sees a vendor not in vendor_icon_cache
--      and not matched against the curated PH registry.
--   2. The new row is inserted with needs_identification=true.
--   3. The dispatcher fires a vendor_identify_request notification
--      (subject "Tell me about: <vendor>") with:
--        - dedupKey = `vendor_identify:${vendor_id}` (silent uniqueness)
--        - 30-minute debounce checked against last_identify_notif_at
--        - 5/hour cap across all vendor_identify_request rows
--   4. Click opens the chatbot scoped to vendor identification.
--   5. The identify-vendor-from-chat brain takes the user reply, writes
--      vendor_icon_cache (user_overridden=true), sets vendors.brand_key,
--      flips needs_identification=false.
--
-- "Skip" path: user replies "skip" → identification_skipped=true and
-- the brain never re-asks for that vendor.

alter table finance.vendors
  add column if not exists needs_identification boolean
    not null default true;

alter table finance.vendors
  add column if not exists identification_skipped boolean
    not null default false;

alter table finance.vendors
  add column if not exists last_identify_notif_at timestamptz;

comment on column finance.vendors.needs_identification is
  'True while the vendor lacks both a curated registry hit and a vendor_icon_cache row. Flipped false by complete/skip actions or by the identify-vendor-from-chat brain.';
comment on column finance.vendors.identification_skipped is
  'User said "skip" — the dispatcher MUST never queue another vendor_identify_request for this row.';
comment on column finance.vendors.last_identify_notif_at is
  'Last time a vendor_identify_request notification was dispatched for this vendor. 30-minute debounce floor.';

-- Backfill: pre-existing vendors that already have a brand_key (set
-- manually or by an earlier branch of the resolver) are considered
-- identified — they do NOT need the new notification.
-- TODO: When migration 0086 adds finance.vendors.brand_key, switch this
-- backfill to also check brand_key IS NOT NULL.
update finance.vendors v
  set needs_identification = false
  where exists (
    select 1
    from finance.vendor_icon_cache c
    where c.user_id = v.user_id
      and c.vendor_name_normalized = lower(regexp_replace(v.canonical_name, '\s+', '', 'g'))
      and c.glyph_kind <> 'none'
  );

create index if not exists vendors_user_needs_identification_idx
  on finance.vendors (user_id, needs_identification)
  where needs_identification = true and identification_skipped = false;
