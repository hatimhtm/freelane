import { getEntitiesData } from "@/lib/data/queries";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode } from "@/lib/supabase/types";
import { EntitiesView } from "@/app/(app)/entities/_components/entities-view";

export const metadata = { title: "Clients · People" };

// People subtab — entities surface. Mirrors /entities so the SubtabBar
// resolves cleanly under /clients. The legacy /entities route stays
// live (command palette + memory links may still point to it) and
// continues to render the same EntitiesView; this page is the
// canonical home going forward.
export default async function ClientsPeoplePage() {
  const { entities, links, spends, settings } = await getEntitiesData();
  const baseCurrency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;

  return (
    <EntitiesView
      entities={entities}
      links={links}
      spends={spends}
      baseCurrency={baseCurrency}
    />
  );
}
