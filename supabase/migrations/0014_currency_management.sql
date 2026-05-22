-- Freelane: let the owner manage the currency list.
--
-- currencies was a read-only global reference (select-only policy). But if a
-- new client pays in a currency that isn't seeded (GBP, AED, JPY…), you need
-- to add it before you can set its exchange rate. This opens up insert/update/
-- delete to authenticated users.
--
-- Single-user app, so a global write policy is fine. Deleting a currency that's
-- still referenced by a rate / project / payment will fail at the FK level
-- (RESTRICT) — that's correct; the action surfaces a friendly error.

create policy "currencies_insert" on finance.currencies
  for insert to authenticated with check (true);

create policy "currencies_update" on finance.currencies
  for update to authenticated using (true) with check (true);

create policy "currencies_delete" on finance.currencies
  for delete to authenticated using (true);

-- Seed a broader common set so most clients are covered out of the box.
insert into finance.currencies (code, name, symbol) values
  ('GBP', 'British Pound',        '£'),
  ('AED', 'UAE Dirham',           'AED'),
  ('SAR', 'Saudi Riyal',          'SAR'),
  ('JPY', 'Japanese Yen',         '¥'),
  ('CAD', 'Canadian Dollar',      'C$'),
  ('AUD', 'Australian Dollar',    'A$'),
  ('SGD', 'Singapore Dollar',     'S$'),
  ('HKD', 'Hong Kong Dollar',     'HK$'),
  ('CHF', 'Swiss Franc',          'CHF'),
  ('INR', 'Indian Rupee',         '₹')
on conflict (code) do nothing;
