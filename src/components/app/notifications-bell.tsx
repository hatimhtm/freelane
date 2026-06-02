import { listOpen, countUnread, type Notification } from "@/lib/notifications/dispatcher";
import { NotificationsPopover } from "./notifications-popover";

export async function NotificationsBell() {
  let unread = 0;
  let open: Notification[] = [];
  try {
    [unread, open] = await Promise.all([countUnread(), listOpen(8)]);
  } catch {
    // Bell renders cleanly when the table isn't reachable yet (mid-migration).
  }

  return <NotificationsPopover unread={unread} open={open} />;
}
