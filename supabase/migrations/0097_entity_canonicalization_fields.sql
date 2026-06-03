-- Freelane: entity canonicalization + discovery + introduction state
-- (Entities workflow — locked 2026-06-02 freelane-entities-design).
--
-- Two consent gates need durable per-entity state:
--   GATE 1 — entity_discovery_request: AI proposes an entity from a
--            signal (spend note / chat / sadaka tag). Stored on a
--            separate denylist row (migration 0098); the entity row
--            doesn't exist yet at this point.
--   GATE 2 — entity_clarify: AFTER the entity row is created (manual
--            or post-Gate-1 confirmation), the Pro canonicalize-entity
--            brain runs and the dispatcher ALWAYS queues a clarify
--            notification regardless of confidence. The new columns
--            below mirror the Vendors workflow's always-ask state:
--              - raw_user_typed_name: what the user (or Gate 1 signal)
--                literally entered, preserved verbatim for the brain.
--              - relationship: the entity's social/role relationship
--                ("wife", "sibling", "uncle", "neighbour"). The Pro
--                brain proposes; the user confirms.
--              - identification_skipped: user dismissed the clarify.
--                Suppresses future kickoffs.
--              - last_clarify_notif_at: 30-min per-entity debounce.
--              - confidence: brain's last canonicalize-entity confidence.
--              - discovered_from: where the signal came from (spend note
--                source, chat message, sadaka, manual). Stored as text
--                without a CHECK so the catalogue can grow.
--              - introduction_status: NEW ELEMENT TRIGGERS state machine.
--                pending  - entity exists but no first-event triggers fired
--                asked    - entity_introduction notification queued
--                introduced - user answered the intro question
--                silenced - user dismissed without answering
--
--   aliases jsonb already exists from migration 0033; guard with
--   `add column if not exists` so re-running this migration is a no-op.
--   canonical_name also pre-exists (0033).
--
-- All ADDs are idempotent.

alter table finance.entities
  add column if not exists raw_user_typed_name text,
  add column if not exists relationship text,
  -- canonical_name already exists from 0033; aliases default '[]'::jsonb
  -- already exists from 0033. Guard both so the migration is safe to rerun.
  add column if not exists identification_skipped boolean default false,
  add column if not exists last_clarify_notif_at timestamptz,
  add column if not exists confidence numeric,
  add column if not exists discovered_from text,
  add column if not exists introduction_status text not null default 'pending';

-- The CHECK constraint must be added separately so the default fills
-- existing rows first (Postgres validates the constraint at attach time
-- against current data — without the default the check would fail on
-- pre-existing rows that are NULL).
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'entities_introduction_status_check'
       and conrelid = 'finance.entities'::regclass
  ) then
    alter table finance.entities
      add constraint entities_introduction_status_check
        check (introduction_status in ('pending','asked','introduced','silenced'));
  end if;
end $$;

-- Backfill raw_user_typed_name from canonical_name for every row that
-- pre-dates the canonicalize-entity flow. The Pro brain reads this as
-- the literal user text; legacy rows treat canonical_name as both source-
-- of-truth and raw-typed (same pattern as vendors 0092).
update finance.entities
  set raw_user_typed_name = canonical_name
  where raw_user_typed_name is null;

comment on column finance.entities.raw_user_typed_name is
  'The literal string the user typed (or the AI inferred from a signal) when this entity was first seen. The Pro canonicalize-entity brain reads this verbatim.';
comment on column finance.entities.relationship is
  'Social/role relationship — "wife", "sibling", "uncle", "neighbour", "friend", "pet_keeper", "colleague". Free-text by design (PH relationships are personal and don''t fit a fixed enum). Proposed by canonicalize-entity, confirmed by the user.';
comment on column finance.entities.identification_skipped is
  'User dismissed the entity_clarify notification. Suppresses future canonicalize-entity kickoffs for this row.';
comment on column finance.entities.last_clarify_notif_at is
  '30-minute per-entity debounce stamp for entity_clarify notifications. Mirrors finance.vendors.last_clarify_notif_at.';
comment on column finance.entities.confidence is
  'Pro canonicalize-entity brain''s confidence on the last run. NULL until the brain has executed at least once.';
comment on column finance.entities.discovered_from is
  'Where this entity was first inferred: "spend_note", "chat_message", "sadaka_payment", "manual_add", "gate1_confirmed". Stored as text without CHECK so the catalogue can grow.';
comment on column finance.entities.introduction_status is
  'NEW ELEMENT TRIGGERS state machine: pending → asked → introduced | silenced. Used by the entity_introduction dispatcher to fire AT MOST ONCE per (entity_id, trigger_kind).';
