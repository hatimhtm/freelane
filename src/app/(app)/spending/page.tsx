import { redirect } from "next/navigation";

export const metadata = { title: "Spending" };

export default async function SpendingPage({
  searchParams,
}: {
  searchParams: Promise<{
    new?: string;
    category?: string;
    m?: string;
    // Loans-redesign deep-link surface: every loan notification handler
    // (loan_due_soon / loan_overdue / loan_proposal-accept) routes the
    // user to `/spending?loans=1&loan_id=<id>`. Forward both params so
    // the Spends subtab can seed `loansOnly` + open the loan detail
    // sheet on first paint instead of dropping the user on an unfiltered
    // list with no sheet.
    loans?: string;
    loan_id?: string;
  }>;
}) {
  // Forward any existing query params (?m=2026-06, ?new=1, ?category=...,
  // ?loans=1, ?loan_id=...) to the Spends subtab so the redirect doesn't
  // lose state from external links (Today's Sadaka quick-log button,
  // command palette, loan notifications).
  const params = await searchParams;
  const sp = new URLSearchParams();
  if (params.m) sp.set("m", params.m);
  if (params.new) sp.set("new", params.new);
  if (params.category) sp.set("category", params.category);
  if (params.loans) sp.set("loans", params.loans);
  if (params.loan_id) sp.set("loan_id", params.loan_id);
  const qs = sp.toString();
  redirect(`/spending/spends${qs ? `?${qs}` : ""}`);
}
