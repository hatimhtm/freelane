import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getEntityDetail, getEntityPatternHistory } from "@/lib/data/queries";
import { getFactsForSubject } from "@/lib/ai/facts";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode } from "@/lib/supabase/types";
import { EntityDetailSheet } from "../_components/entity-detail-sheet";

export const metadata = { title: "Person" };

// Entity detail under the People sub-tab. Mirrors the legacy
// /entities/[id] page (which now redirects here) but renders the new
// EntityDetailSheet with Facts + Notes + Interaction history.
export default async function PeopleEntityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { entity, links, spends, settings } = await getEntityDetail(id);
  if (!entity) notFound();
  const facts = await getFactsForSubject("entity", id);
  // Verifier fix: getEntityPatternHistory feeds the pattern-change
  // timeline section in the detail sheet — mirrors the Clients
  // workflow.
  const patternHistory = await getEntityPatternHistory(id);
  const baseCurrency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-5 p-4 sm:p-6">
      <Link
        href="/clients/people"
        className="inline-flex items-baseline gap-1 self-start text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        People
      </Link>
      <EntityDetailSheet
        entity={entity}
        links={links}
        spends={spends}
        facts={facts}
        patternHistory={patternHistory}
        baseCurrency={baseCurrency}
      />
    </div>
  );
}
