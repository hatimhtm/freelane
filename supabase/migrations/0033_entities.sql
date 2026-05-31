-- Freelane: entity layer for Life-OS curiosity.
--
-- The AI noticed "cat treats" in a spend → asked Hatim "do you have cats? how
-- many, how old?" → that's an entity. So is Lola (the grandmother he buys
-- things for), Tito (a typical loan counterparty), the household itself, a
-- cat, a friend the Sadaka tag mentions. Entities anchor curiosity questions,
-- accumulate AI-curated memory, and let the future "Wife Preferences Corpus"
-- (#25) layer write to a real row instead of guessing every time.
--
-- kind enum is intentionally open via a TEXT column (not pg enum) so the
-- catalog grows ("place", "pet", "vendor", "household", "person", "concept",
-- "ritual", "habit", …) without alter-type pressure.
--
-- vague boolean (Tier-2 H — Vague Entity Support): true means the entity was
-- created from a fuzzy descriptor ("dumplings shop my wife likes"), with NO
-- canonical name yet. The AI is allowed to keep these around and offer to
-- merge or expand later. UI surfaces them in a quieter tone.

create table if not exists finance.entities (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  kind                 text not null,                      -- 'person' | 'pet' | 'place' | 'household' | 'vendor_ref' | 'concept' | 'habit' | 'ritual'
  canonical_name       text not null,                      -- "Lola", "Tito", "Our cats", "Household"
  -- Free-text 1-line context.
  short_description    text,
  -- Lowercase aliases (kept inline as a jsonb array for fast lookup; mirrors
  -- vendor_aliases pattern but lower-friction for the AI's curiosity queue).
  aliases              jsonb not null default '[]'::jsonb,
  -- AI-consolidated memory mirroring client / user / vendor patterns.
  memory_consolidated  jsonb not null default '{}'::jsonb,
  -- Vague-entity marker — true for fuzzy descriptors with no canonical name yet.
  vague                boolean not null default false,
  notes                text,
  archived             boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists entities_user_kind_idx
  on finance.entities (user_id, kind)
  where archived = false;

-- Fuzzy lookup on canonical_name + short_description.
create index if not exists entities_canonical_name_trgm_idx
  on finance.entities using gin (canonical_name gin_trgm_ops);

create trigger entities_touch
  before update on finance.entities
  for each row execute function finance.touch_updated_at();

alter table finance.entities enable row level security;

create policy "owner_all" on finance.entities
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Spend ↔ Entity m2m ──
-- A spend referencing both "Wife" (entity) and "Cats" (entity) gets two rows.
-- Used by the AI to read "the household tag is on N spends this month" without
-- duplicating the per-entity walk.
create table if not exists finance.spend_entity_links (
  spend_id    uuid not null references finance.spends(id) on delete cascade,
  entity_id   uuid not null references finance.entities(id) on delete cascade,
  source      text not null default 'auto',               -- 'auto' | 'user' | 'ai_suggest'
  created_at  timestamptz not null default now(),
  primary key (spend_id, entity_id)
);

create index if not exists spend_entity_links_entity_idx
  on finance.spend_entity_links (entity_id);

alter table finance.spend_entity_links enable row level security;

create policy "owner_via_spend" on finance.spend_entity_links
  for all
  using (exists (select 1 from finance.spends s where s.id = spend_id and s.user_id = auth.uid()))
  with check (exists (select 1 from finance.spends s where s.id = spend_id and s.user_id = auth.uid()));

-- ── Seed default entities for the existing user ──
-- Known entities: Wife (already a seed category but a real entity too),
-- Household (the "it is for us" surface), the cats (entity created on first
-- cat-treats mention). Plus a couple of likely future ones (Lola for gifts,
-- Tito for loans). User can archive/edit anything they don't want.
--
-- Uses PostgreSQL dollar-quoting ($seed$...$seed$) for every string so
-- apostrophes, em-dashes, parens, and quotes all pass through cleanly. The
-- earlier '...' escaped form broke when a SQL client auto-normalized the
-- `''` escape to a single `'` during paste.
insert into finance.entities (user_id, kind, canonical_name, short_description, vague, notes)
select s.user_id, v.kind, v.canonical_name, v.short_description, v.vague, v.notes
from finance.settings s
cross join (values
  ($seed$household$seed$, $seed$Household$seed$,
   $seed$Hatim plus wife (and the cats once they live together). The it-is-for-us surface.$seed$,
   false,
   $seed$Maps to spends.for_us=true. AI uses this row to track shared-life spending.$seed$),
  ($seed$person$seed$, $seed$Wife$seed$,
   $seed$Hatim wife. 3rd-year university student. Pays her own tuition.$seed$,
   false,
   $seed$Maps to the Wife category. Wife Preferences Corpus (#25) consolidates into this row.$seed$),
  ($seed$pet$seed$, $seed$Our cats$seed$,
   $seed$Cats Hatim shares life with. AI noticed cat-treats spends and asked.$seed$,
   true,
   $seed$Vague at first; user confirms count + names as the AI asks.$seed$),
  ($seed$person$seed$, $seed$Lola$seed$,
   $seed$Grandmother Hatim buys things for occasionally.$seed$,
   false,
   $seed$Family entity. Used when a spend mentions for Lola.$seed$),
  ($seed$person$seed$, $seed$Tito$seed$,
   $seed$Common counterparty name for personal loans (friends, uncles).$seed$,
   false,
   $seed$Not a single person -- a pattern. AI may suggest splitting per-Tito later.$seed$)
) as v(kind, canonical_name, short_description, vague, notes)
where not exists (
  select 1 from finance.entities e
   where e.user_id = s.user_id and e.canonical_name = v.canonical_name
);
