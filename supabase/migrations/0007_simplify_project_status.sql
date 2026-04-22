-- Freelane: collapse the project_status enum down to 3 states that match
-- how the user actually thinks: unpaid, partially_paid, paid (+ archived
-- which we keep for historical projects). Old values (quoted, in_progress,
-- invoiced, overdue) get migrated to 'unpaid'. We can't cleanly drop enum
-- values in Postgres, so we just stop referencing them in app code — the
-- values remain in the type but no row ever points to them again.

-- 1) Add the new value to the enum (if not already there)
alter type finance.project_status add value if not exists 'unpaid';

-- 2) Migrate existing rows. Commit so the enum change becomes visible to
--    subsequent statements in the same migration.
commit;
begin;

update finance.projects
   set status = 'unpaid'::finance.project_status
 where status::text in ('quoted', 'in_progress', 'invoiced', 'overdue');
