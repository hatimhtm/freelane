-- Per-item quantity on spends. Common case: "3 × eggs ₱180" — currently the
-- only way to record that was to type "eggs ×3" into the name. Now the qty
-- gets its own column so the AI + price-intel + leaderboards can reason about
-- unit prices instead of total prices. Default 1 so existing rows behave as
-- before; nullable not allowed because every line implies at least one unit.

alter table finance.spend_items
  add column if not exists quantity numeric(10, 3) not null default 1
  check (quantity > 0);
