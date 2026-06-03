import { getEntitiesPeopleData } from "@/lib/data/queries";
import { PeopleView } from "./_components/people-view";

export const metadata = { title: "Clients · People" };

// People sub-tab — Entities workflow surface (freelane-entities-design
// 2026-06-03). Lives at /clients/people; the legacy /entities URL
// redirects here.
export default async function ClientsPeoplePage() {
  const { needsIntroduction, active, archived } =
    await getEntitiesPeopleData();
  return (
    <PeopleView
      needsIntroduction={needsIntroduction}
      active={active}
      archived={archived}
    />
  );
}
