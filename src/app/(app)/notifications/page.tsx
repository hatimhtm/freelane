import { Bell } from "lucide-react";
import {
  listInbox,
  readNotificationSettings,
  type Notification,
} from "@/lib/notifications/dispatcher";
import { DEFAULT_NOTIFICATION_SETTINGS } from "@/lib/notifications/types";
import { NotificationsView } from "./_components/notifications-view";

export const metadata = { title: "Notifications" };

type Search = { open?: string };

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams?: Promise<Search>;
}) {
  const sp = (await searchParams) ?? {};
  let rows: Notification[] = [];
  let retentionDays = DEFAULT_NOTIFICATION_SETTINGS.retention_days;
  let retentionForever = DEFAULT_NOTIFICATION_SETTINGS.retention_forever;
  try {
    const [r, settings] = await Promise.all([
      listInbox(120),
      readNotificationSettings(),
    ]);
    rows = r;
    retentionDays = settings.retention_days;
    retentionForever = settings.retention_forever;
  } catch {
    rows = [];
  }
  return (
    <NotificationsView
      rows={rows}
      icon={Bell}
      retentionDays={retentionDays}
      retentionForever={retentionForever}
      legacyOpenTuesday={sp.open === "tuesday"}
    />
  );
}
