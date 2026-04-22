-- Freelane: add CNY to the supported currencies list.
-- CNY is the currency most client payments arrive in; PHP remains the base.

insert into finance.currencies (code, name, symbol) values
  ('CNY', 'Chinese Yuan', '¥')
on conflict (code) do nothing;
