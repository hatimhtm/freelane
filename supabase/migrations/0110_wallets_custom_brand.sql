-- Freelane: custom brand fallback for wallets.
--
-- The brand picker (Settings → Wallets) seeds the 6 curated brands from
-- WALLET_BRANDS. Some users have a wallet that doesn't match any curated
-- brand AND doesn't fuzzy-match either — for those, the new "Custom"
-- tile in the brand picker lets them pick a one-character glyph + hex
-- color that the resolver renders verbatim.
--
-- Storage lives on finance.payment_methods (the canonical wallet-of-record
-- table — wallet brand metadata already lives here via brand_key, added
-- in migration 0078). Both columns are nullable; resolveWalletBrand uses
-- them only when the curated registry has no entry for brand_key.

alter table finance.payment_methods
  add column if not exists custom_brand_glyph text;

alter table finance.payment_methods
  add column if not exists custom_brand_color text;

-- Lightweight format gate — colors should look like hex (#abc or #abcdef).
-- Null passes (the column is optional). Anything else is rejected so a
-- malformed colour never reaches the render layer.
alter table finance.payment_methods
  drop constraint if exists payment_methods_custom_brand_color_format;

alter table finance.payment_methods
  add constraint payment_methods_custom_brand_color_format
  check (
    custom_brand_color is null
    or custom_brand_color ~ '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$'
  );

-- Glyph is a single character (emoji or letter). Cap at 4 chars so an
-- accidental paste of the wallet's full name doesn't render as a giant
-- block of text inside a 32x32 tile.
alter table finance.payment_methods
  drop constraint if exists payment_methods_custom_brand_glyph_length;

alter table finance.payment_methods
  add constraint payment_methods_custom_brand_glyph_length
  check (
    custom_brand_glyph is null
    or char_length(custom_brand_glyph) between 1 and 4
  );
