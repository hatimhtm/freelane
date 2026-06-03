-- Freelane: drop finance.app_changelog (replaced by CHANGELOG.md at the
-- repo root per migration 0104 + freelane-whatsnew-design 2026-06-02).
--
-- Why a separate migration: migration 0104 was the marker that pivoted
-- the source of truth and added settings.last_seen_version. This file
-- removes the now-orphaned SQL table once the new reader is live. The
-- separation keeps the rollback story clean — reverting 0105 alone
-- restores the table shell, and 0104 can stay deployed.
--
-- The migration is intentionally CASCADE-aware (no FK references should
-- exist, but a stray view or generated index inside the schema gets
-- swept with the parent). Both the table and its enum live under the
-- finance schema; we drop them in dependency order.
--
-- Idempotent: every drop is gated with IF EXISTS.
--
-- The activity-feed renderer still understands the event kind
-- 'app_changelog.published' so legacy rows in finance.events stay
-- readable. New events of that kind will never be written — the
-- create/update/delete actions that emitted them were removed from
-- src/lib/data/actions.ts in the same change.

drop trigger if exists app_changelog_touch on finance.app_changelog;

drop index if exists finance.app_changelog_version_idx;
drop index if exists finance.app_changelog_released_idx;
drop index if exists finance.app_changelog_pinned_idx;

drop table if exists finance.app_changelog cascade;

drop type if exists finance.app_changelog_kind;
