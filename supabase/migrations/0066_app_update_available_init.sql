-- Freelane Notifications — explicit initialiser for the `app_update_available`
-- notification kind in every user's per_kind_prefs map.
--
-- WHY THIS EXISTS (and why it's idempotent):
-- The dispatcher (lib/notifications/dispatcher.ts) treats any missing kind in
-- per_kind_prefs as { in_app: true, push: false, sound: false }, so this
-- migration is NOT functionally required for delivery. It exists so that the
-- Settings → Notifications surface — which iterates KNOWN_KINDS and renders a
-- toggle row per kind — shows the user's stored preference explicitly the
-- first time they view it, rather than relying on the implicit default and
-- only persisting the row once the toggle is touched.
--
-- It is a placeholder in the sense that the *behaviour* is unchanged either
-- way; it makes the persisted state self-describing for any future tooling
-- that inspects per_kind_prefs directly (Settings export, audit, backups).
--
-- SAFE TO RE-RUN: uses jsonb_set with `create_missing => true` only when the
-- key is absent. Rows that already carry an `app_update_available` entry
-- (for whatever reason — manual edit, hand-seeded test data, etc.) are
-- preserved as-is.

update finance.notification_settings
set per_kind_prefs = jsonb_set(
  per_kind_prefs,
  '{app_update_available}',
  '{"in_app": true, "push": false, "sound": false}'::jsonb,
  true
)
where not (per_kind_prefs ? 'app_update_available');
