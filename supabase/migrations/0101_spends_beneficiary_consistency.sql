-- Freelane: structural consistency check for the "For someone else"
-- toggle vs the beneficiary entity link (Entities workflow).
--
-- Verifier finding: nothing at the DB level prevented the inconsistent
-- (is_for_someone_else=false, beneficiary_entity_id IS NOT NULL) state.
-- The spend modal zeroes beneficiary_entity_id when the toggle is off,
-- but a future caller, a manual SQL fix, or a partially-applied patch
-- in updateSpend could leak the inconsistent tuple. Stats readers and
-- entity-detail surfaces both trust the toggle as the source of truth
-- ("show beneficiaries only when the user said it was for someone
-- else") — if the tuple drifts, those reads silently mislabel rows.
--
-- The constraint is structural: is_for_someone_else=false implies
-- beneficiary_entity_id IS NULL. The reverse direction
-- (is_for_someone_else=true with beneficiary_entity_id IS NULL) is
-- still legitimate — the brief explicitly allows it so the Gate 1
-- discovery_request can fire from the typed name even when the user
-- couldn't identify the beneficiary yet.

-- Sweep any stray inconsistent rows BEFORE adding the constraint so an
-- existing user's data won't reject the ALTER TABLE. The cheapest fix
-- is to null the beneficiary_entity_id on toggle-off rows — they were
-- semantically not-for-someone-else anyway, and the spend_entity_links
-- mirror row (if any) stays intact for reader compatibility.
update finance.spends
   set beneficiary_entity_id = null
 where is_for_someone_else = false
   and beneficiary_entity_id is not null;

alter table finance.spends
  add constraint spends_beneficiary_consistency_check
    check (is_for_someone_else or beneficiary_entity_id is null);

comment on constraint spends_beneficiary_consistency_check
  on finance.spends is
  'Structural invariant — when the "For someone else" toggle is off, beneficiary_entity_id must be NULL. Prevents stats / entity-detail surfaces from mislabelling a beneficiary-cleared spend as still-for-someone-else.';
