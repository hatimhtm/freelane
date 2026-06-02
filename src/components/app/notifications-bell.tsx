import {
  listOpen,
  listReadRecent,
  countUnread,
  readNotificationSettings,
  type Notification,
} from "@/lib/notifications/dispatcher";
import { DEFAULT_NOTIFICATION_SETTINGS } from "@/lib/notifications/types";
import { NotificationsPopover } from "./notifications-popover";

export async function NotificationsBell() {
  let unread = 0;
  let open: Notification[] = [];
  let read: Notification[] = [];
  let retentionDays = DEFAULT_NOTIFICATION_SETTINGS.retention_days;
  let retentionForever = DEFAULT_NOTIFICATION_SETTINGS.retention_forever;
  try {
    const [u, o, r, settings] = await Promise.all([
      countUnread(),
      listOpen(8),
      listReadRecent(8),
      readNotificationSettings(),
    ]);
    unread = u;
    open = o;
    read = r;
    retentionDays = settings.retention_days;
    retentionForever = settings.retention_forever;
  } catch {
    // Bell renders cleanly when the table isn't reachable yet (mid-migration).
  }

  return (
    <NotificationsPopover
      unread={unread}
      open={open}
      read={read}
      retentionDays={retentionDays}
      retentionForever={retentionForever}
    />
  );
}
