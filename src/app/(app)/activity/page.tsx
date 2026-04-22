import { Activity } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { getEvents } from "@/lib/data/queries";
import { ActivityFeed } from "./_components/activity-feed";

export const metadata = { title: "Activity" };

export default async function ActivityPage() {
  const { events, clients } = await getEvents();
  const clientsById = new Map(clients.map((c) => [c.id, c.name]));

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-10">
      <PageHeader
        title="Activity"
        description="Everything that happened, newest first. Freelane keeps this so you — and future you — have full history."
      />
      <div className="mt-8">
        {events.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="Nothing logged yet"
            description="Changes you make — new clients, status moves, payments logged, invoices created — will show up here."
          />
        ) : (
          <ActivityFeed events={events} clientsById={clientsById} />
        )}
      </div>
    </div>
  );
}
