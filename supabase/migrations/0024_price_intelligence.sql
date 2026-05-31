-- Freelane: price intelligence — the table where the AI's knowledge of what
-- things SHOULD cost lives.
--
-- Empty table for now. Layer 1 of price intelligence (Phase 1.5) is
-- history-only: the AI reads the user's own spend_items to answer "is ₱180 a
-- normal price for this?". This table is what Layer 2 (Phase 2) will populate
-- by seeding from Gemini grounding web search at San Pablo retail stores (Dali,
-- AlfaMart, 7-Eleven, Robinsons, Puregold) + online (Lazada, Shopee). Web
-- seeding is NOT in scope for 0024 — the schema ships now so Phase 2 has
-- somewhere to write without a fresh migration.
--
-- item_name_norm is the canonical join key: lowercased, trimmed ("rice 5kg",
-- "san miguel light 330ml"). store_name nullable, where null means an averaged
-- entry across stores (the "typical local price" row). source records where
-- the row came from so the AI can weight confidence:
--   ai_prior     — Gemini's pre-existing world knowledge (cold start, weakest)
--   web_search   — Gemini grounding hit on a specific retailer (Phase 2)
--   user_history — distilled from this user's own past spend_items (strongest)

create table if not exists finance.price_intelligence (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  item_name_norm  text not null,
  store_name      text,
  price_low       numeric(10, 2),
  price_typical   numeric(10, 2),
  price_high      numeric(10, 2),
  currency        text not null default 'PHP' references finance.currencies(code),
  location        text default 'San Pablo, Laguna',
  source          text not null check (source in ('ai_prior', 'web_search', 'user_history')),
  last_seen_at    timestamptz not null default now(),
  notes           text,
  unique (user_id, item_name_norm, store_name)
);

-- Lookup: "what do I know about <item>?" — fast hit across all stores.
create index if not exists price_intelligence_item_idx
  on finance.price_intelligence (user_id, item_name_norm);

-- Maintenance: "what's stalest, time to re-seed?" — drives Phase 2 refresh job.
create index if not exists price_intelligence_last_seen_idx
  on finance.price_intelligence (user_id, last_seen_at desc);

alter table finance.price_intelligence enable row level security;

create policy "owner_all" on finance.price_intelligence
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
