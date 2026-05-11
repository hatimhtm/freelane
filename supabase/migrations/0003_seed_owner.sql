-- Freelane: seed the initial settings row + starter exchange rates for the owner.
-- Replace the placeholder UUID below with your own Supabase auth user UUID
-- before running this migration.
--
-- To find yours after creating the owner@freelane.local user in Supabase Auth:
--   select id from auth.users where email = 'owner@freelane.local';
--
-- rate_to_base = "how many base-currency units per 1 unit of this currency"

-- ── Set this to your own user UUID before running ──
\set owner_uuid '00000000-0000-0000-0000-000000000000'

insert into finance.settings (user_id, base_currency, invoice_language, theme)
values (:'owner_uuid', 'PHP', 'fr', 'dark')
on conflict (user_id) do nothing;

insert into finance.exchange_rates (user_id, code, rate_to_base) values
  (:'owner_uuid', 'PHP', 1.0),
  (:'owner_uuid', 'CNY', 7.50),
  (:'owner_uuid', 'MAD', 5.70),
  (:'owner_uuid', 'USD', 57.00),
  (:'owner_uuid', 'EUR', 62.00)
on conflict (user_id, code) do nothing;
