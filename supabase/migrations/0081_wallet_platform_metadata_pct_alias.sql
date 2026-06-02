-- Freelane: wallet_platform_metadata view alias for typical_fee_pct.
--
-- Migration 0080 stored the typical fee column as `typical_fee_fraction`
-- (a [0,1] fraction so the units match paymentFee().pct in
-- payment-chain.ts). The original brief named the column
-- `typical_fee_pct`. The rename is deliberate and documented in the
-- 0080 header, but this view keeps the brief's schema name reachable
-- for any external callers (downstream tooling, ad-hoc SQL) that wrote
-- against the original name. The view ALIASES — it does NOT convert
-- units, so `typical_fee_pct` here remains a [0,1] fraction. Callers
-- that genuinely want a percent value should multiply by 100 at read
-- time; the column kept "fraction" semantics on purpose.
--
-- Reader code in src/lib/supabase/types.ts continues to use the
-- canonical `typical_fee_fraction` field name — the view exists only
-- for compatibility, not as the new source of truth.
--
-- Security inherits from the underlying table: RLS on
-- wallet_platform_metadata gates row visibility, and authenticated
-- writes were revoked in 0080. The view adds no new surface area.

create or replace view finance.wallet_platform_metadata_v_pct as
select
  brand_key,
  display_name,
  platform_type,
  base_currency,
  typical_fee_fraction         as typical_fee_pct,
  typical_fee_flat_php,
  typical_speed_hours,
  supports_inbound,
  supports_outbound,
  notes,
  updated_at
from finance.wallet_platform_metadata;

comment on view finance.wallet_platform_metadata_v_pct is
  'Backwards-compat alias for the wallet_platform_metadata table. Maps typical_fee_fraction back to the brief''s typical_fee_pct name without unit conversion (the value is still a [0,1] fraction).';
