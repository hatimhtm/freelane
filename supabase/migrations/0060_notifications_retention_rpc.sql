-- Freelane Notifications — single-call retention RPC.
--
-- The /api/cron/notifications-retention route used to loop per-user and
-- issue N PostgREST DELETEs (one HTTP round trip each). At ~10k users that
-- would time out the Vercel function before it ever finished. This RPC
-- collapses the whole job into ONE SQL statement that deletes every
-- read row whose user's retention window has expired, in one transaction.
--
-- The LEFT JOIN against auth.users ensures users without a
-- notification_settings row (shouldn't happen after migration 0059, but
-- defense-in-depth) still get the 3-day default applied instead of
-- silently keeping read rows forever.

create or replace function finance.run_notifications_retention()
returns int
language plpgsql
security definer
set search_path = public, finance
as $$
declare
  deleted_count int;
begin
  with effective as (
    select
      u.id as user_id,
      coalesce(s.retention_days, 3) as retention_days,
      coalesce(s.retention_forever, false) as retention_forever
    from auth.users u
    left join finance.notification_settings s on s.user_id = u.id
  ),
  doomed as (
    delete from finance.notifications_inbox i
    using effective e
    where i.user_id = e.user_id
      and e.retention_forever = false
      and i.read_at is not null
      and i.read_at < now() - make_interval(days => greatest(e.retention_days, 1))
    returning 1
  )
  select count(*) into deleted_count from doomed;

  return deleted_count;
end;
$$;

comment on function finance.run_notifications_retention() is
  'Daily retention sweep — hard-deletes read notifications older than each user''s retention_days. Called by /api/cron/notifications-retention. Unread rows are NEVER deleted.';
