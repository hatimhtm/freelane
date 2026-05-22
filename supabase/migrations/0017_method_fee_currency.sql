-- Let a payment method's recurring monthly fee be denominated in any currency,
-- not just the base. The amount still lives in monthly_fee_php (kept for
-- compatibility); this column says what currency that amount is in. NULL means
-- "already in base currency" (how every existing row behaves today).
alter table finance.payment_methods
  add column if not exists monthly_fee_currency text references finance.currencies(code);
