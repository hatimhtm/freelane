-- Freelane: seed the initial settings row + starter exchange rates for the owner.
-- Rates are rough 2026 placeholders — you'll update them in the Settings UI.
-- rate_to_base = "how many PHP per 1 unit of this currency"

insert into finance.settings (user_id, base_currency, invoice_language, theme)
values ('00000000-0000-0000-0000-000000000000', 'PHP', 'fr', 'dark')
on conflict (user_id) do nothing;

insert into finance.exchange_rates (user_id, code, rate_to_base) values
  ('00000000-0000-0000-0000-000000000000', 'PHP', 1.0),
  ('00000000-0000-0000-0000-000000000000', 'CNY', 7.50),
  ('00000000-0000-0000-0000-000000000000', 'MAD', 5.70),
  ('00000000-0000-0000-0000-000000000000', 'USD', 57.00),
  ('00000000-0000-0000-0000-000000000000', 'EUR', 62.00)
on conflict (user_id, code) do nothing;
