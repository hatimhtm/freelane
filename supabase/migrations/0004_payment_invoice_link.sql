-- Freelane: link a payment to an optional invoice (1 payment ↔ 0-or-1 invoice).
-- This is the "create invoice from this payment" feature: when you click the button,
-- an invoice is created and we remember which payment it was born from.

alter table finance.payments
  add column if not exists invoice_id uuid references finance.invoices(id) on delete set null;

create index if not exists payments_invoice_idx on finance.payments (invoice_id);
