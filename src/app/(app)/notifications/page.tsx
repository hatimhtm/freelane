import { Bell } from "lucide-react";
import { listInbox, type Notification } from "@/lib/notifications/dispatcher";
import { getCurrentWellbeingCheckin } from "@/lib/data/queries";
import { promptForWeek } from "@/lib/ai/tuesday-checkin";
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
  let tuesdayPrompt = "";
  let tuesdayCheckin: Awaited<ReturnType<typeof getCurrentWellbeingCheckin>> = null;
  try {
    rows = await listInbox(120);
  } catch {
    rows = [];
  }
  if (sp.open === "tuesday") {
    try {
      [tuesdayPrompt, tuesdayCheckin] = await Promise.all([
        promptForWeek(),
        getCurrentWellbeingCheckin(),
      ]);
    } catch {
      tuesdayPrompt = "";
    }
  }
  return (
    <NotificationsView
      rows={rows}
      icon={Bell}
      openTuesday={sp.open === "tuesday"}
      tuesdayPrompt={tuesdayPrompt}
      tuesdayCheckin={tuesdayCheckin}
    />
  );
}
