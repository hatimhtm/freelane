import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getEntityDetail, getEntityPatternHistory } from "@/lib/data/queries";
import { getFactsForSubject } from "@/lib/ai/facts";
import { getLoansForEntity } from "@/lib/loans/queries";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import type { CurrencyCode, LoanReturn } from "@/lib/supabase/types";
import { EntityDetailSheet } from "../_components/entity-detail-sheet";

export const metadata = { title: "Person" };

// Entity detail under the People sub-tab. Mirrors the legacy
// /entities/[id] page (which now redirects here) but renders the new
// EntityDetailSheet with Facts + Notes + Interaction history + Loans.
export default async function PeopleEntityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [{ entity, links, spends, settings }, loanSummary] = await Promise.all([
    getEntityDetail(id),
    // Loans workflow — per-entity loan history + outstanding totals
    // feed the read-only LoansSection in the detail sheet (mutating
    // actions live in the spending-list loan detail sheet, the single
    // owner of the state machine).
    getLoansForEntity(id),
  ]);
  if (!entity) notFound();
  const facts = await getFactsForSubject("entity", id);
  // Verifier fix: getEntityPatternHistory feeds the pattern-change
  // timeline section in the detail sheet — mirrors the Clients
  // workflow.
  const patternHistory = await getEntityPatternHistory(id);
  const baseCurrency = (settings?.base_currency ?? BASE_CURRENCY_FALLBACK) as CurrencyCode;

  // Flatten the returns map into a single array so the client component
  // can re-bucket by loan_id without depending on Map serialization.
  const loanReturns: LoanReturn[] = [];
  for (const arr of loanSummary.returnsByLoan.values()) {
    for (const r of arr) loanReturns.push(r);
  }

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
        loans={loanSummary.loans}
        loanReturns={loanReturns}
        loanTotals={loanSummary.totals}
      />
    </div>
  );
}
