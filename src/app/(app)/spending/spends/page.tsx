import { SpendingView } from "../_components/spending-view";
import { loadSpendingProps } from "../_components/spending-data";

export const metadata = { title: "Spending · Spends" };

export default async function SpendingSpendsPage({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string;
    category?: string;
    m?: string;
    // Loans deep-link params forwarded from /spending. SpendingView seeds
    // its `loansOnly` filter + opens the loan detail sheet when both are
    // present so the loan notifications land the user exactly where the
    // notification promised — otherwise the deep link would drop the
    // user on an unfiltered list with no sheet open.
    loans?: string;
    loan_id?: string;
  }>;
}) {
  const params = await searchParams;
  const props = await loadSpendingProps(params);
  return (
    <SpendingView
      {...props}
      tab="spends"
      initialLoansOnly={params.loans === "1"}
      initialOpenLoanId={params.loan_id ?? null}
    />
  );
}
