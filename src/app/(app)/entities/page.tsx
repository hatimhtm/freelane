import { getEntitiesData } from "@/lib/data/queries";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode } from "@/lib/supabase/types";
import { EntitiesView } from "./_components/entities-view";

export const metadata = { title: "Entities" };

export default async function EntitiesPage() {
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
