import { SpendingView } from "../_components/spending-view";
import { loadSpendingProps } from "../_components/spending-data";

export const metadata = { title: "Spending · Trends" };

export default async function SpendingTrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const params = await searchParams;
  const props = await loadSpendingProps(params);
  return <SpendingView {...props} tab="trends" />;
}
