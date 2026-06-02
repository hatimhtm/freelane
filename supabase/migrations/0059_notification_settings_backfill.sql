-- Freelane Notifications — backfill notification_settings + after-signup
-- trigger so every auth.users row has exactly one notification_settings row.
--
-- WHY: the retention cron at /api/cron/notifications-retention iterates
-- finance.notification_settings to find users to apply retention to. If a
-- user never opens Settings → Notifications, no row exists, and their
-- read notifications accumulate indefinitely. The dispatcher's first-read
-- upsert (see readNotificationSettings) closes part of the gap, but only
-- for users who actively use notifications — this migration plus the
-- after-signup trigger guarantee EVERY user is covered without depending
-- on any UI surface being hit.

-- 1) Backfill existing users.
insert into finance.notification_settings (user_id)
select u.id
from auth.users u
where not exists (
  select 1 from finance.notification_settings s where s.user_id = u.id
);

-- 2) Trigger: insert defaults whenever a new auth.users row lands.
--    SECURITY DEFINER so the function can write into finance schema
--    regardless of the inserting role (the auth schema's insert runs as
--    a privileged role, but trigger functions need explicit definer
--    rights to bypass RLS on finance.notification_settings).
create or replace function finance.create_notification_settings_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, finance
as $$
begin
  insert into finance.notification_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_notification_settings on auth.users;

create trigger on_auth_user_created_notification_settings
  after insert on auth.users
  for each row
  execute function finance.create_notification_settings_for_new_user();
