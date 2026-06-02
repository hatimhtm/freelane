import { SpendingView } from "../_components/spending-view";
import { loadSpendingProps } from "../_components/spending-data";

export const metadata = { title: "Spending · Spends" };

export default async function SpendingSpendsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; category?: string; m?: string }>;
}) {
  const params = await searchParams;
  const props = await loadSpendingProps(params);
  return <SpendingView {...props} tab="spends" />;
}
