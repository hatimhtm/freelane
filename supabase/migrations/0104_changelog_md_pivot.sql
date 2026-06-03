-- Freelane: pivot the app changelog from a SQL table to CHANGELOG.md in
-- the repo root (freelane-whatsnew-design 2026-06-02).
--
-- WHAT CHANGED
--   - CHANGELOG.md (Keep-a-Changelog format) is now the single source of
--     truth for the in-product Updates surface (Settings -> Updates) AND
--     for the macOS Swift companion's What's New menu via
--     /api/changelog.json.
--   - The /changelog route now redirects to /settings/updates. The
--     old SQL-backed create/update/delete server actions and the
--     getAppChangelog() query helper were removed.
--   - A daily Vercel cron at 9 AM PHT (1 AM UTC) fetches the upstream
--     raw markdown from GitHub and fires an `app_update_available`
--     notification when a newer release lands. The dedup key is
--     `app_update_available:<version>` so re-runs are idempotent.
--
-- WHAT THIS MIGRATION ACTUALLY TOUCHES
--   - finance.settings gains a `last_seen_version` text column so the
--     Settings landing can paint a small red dot on the Updates row
--     when the user hasn't acknowledged the current release yet.
--   - finance.app_changelog STAYS PUT for now. Migration 0105 (the
--     companion drop) removes it once the markdown pivot has been
--     deployed at least once. Keeping the table around for this
--     migration cycle lets a partial deploy fall back to the old
--     reader without a hard schema mismatch.
--
-- IDEMPOTENCY
--   - The ADD COLUMN is guarded by IF NOT EXISTS.
--   - No data is moved or seeded — the CHANGELOG.md backfill is
--     hand-authored in the repo (see CHANGELOG.md). The SQL rows in
--     finance.app_changelog are intentionally NOT mirrored back into the
--     markdown; the markdown is the new history.

alter table finance.settings
  add column if not exists last_seen_version text;

comment on column finance.settings.last_seen_version is
  'Most recent CHANGELOG.md version this user opened in Settings -> Updates. '
  'Drives the red-dot badge on the Settings landing. NULL means the user has '
  'never opened the Updates page; the badge paints by default.';
