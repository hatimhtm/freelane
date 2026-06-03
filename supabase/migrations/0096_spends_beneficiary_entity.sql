-- Freelane: "buying for entities" linkage on finance.spends (Entities workflow).
--
-- Hatim's clarification: "wife is an entity, friends are entities — I can
-- buy stuff for them (food, gift). That should be included." When the
-- user flips the "For someone else" toggle on the spend modal and picks a
-- beneficiary, that single signal needs to drive THREE downstream
-- pipelines without joining through spend_entity_links every time:
--
--   1. Entity detail's interaction history (per-entity beneficiary spend
--      list + count).
--   2. Pattern detection (interaction_kind=beneficiary_spend feeds the
--      EWMA + stddev pattern brain).
--   3. Sadaka auto-debit mechanism 1 — when the beneficiary entity has
--      entities.sadaka_recipient=true, the createSpend pipeline writes a
--      sadaka_ledger payment row tied to the spend.
--
-- Two columns instead of one because the toggle has its OWN truth value
-- ("yes, this was for someone else") independent of whether the user
-- managed to identify the beneficiary. is_for_someone_else=true with
-- beneficiary_entity_id=null is a legitimate state: the Gate 1
-- discovery_request can still fire from this signal even if the user
-- couldn't pick a person yet.
--
-- spend_entity_links stays the source of truth for "any entity tied to
-- this spend" (the column is added for fast direct reads + the index for
-- the entity detail sheet's beneficiary list). createSpend writes BOTH
-- when the beneficiary is set: the column AND a spend_entity_links row
-- with source='user' so legacy readers keep working.

alter table finance.spends
  add column if not exists beneficiary_entity_id uuid
    references finance.entities(id) on delete set null,
  add column if not exists is_for_someone_else boolean not null default false;

create index if not exists spends_beneficiary_entity_idx
  on finance.spends (beneficiary_entity_id)
  where beneficiary_entity_id is not null;

comment on column finance.spends.beneficiary_entity_id is
  'Entity the spend was made FOR (gift / food / errand). NULL = either spend is for the user themselves OR for_someone_else=true but beneficiary still unidentified. Drives entity interaction history, pattern detection, and Sadaka auto-debit mechanism 1.';
comment on column finance.spends.is_for_someone_else is
  '"For someone else" toggle on the spend modal. Independent of beneficiary_entity_id so the discovery_request notification can still fire when the user knows the spend was for someone but hasn''t identified them yet.';
