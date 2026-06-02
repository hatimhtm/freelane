import { SpendingView } from "../_components/spending-view";
import { loadSpendingProps } from "../_components/spending-data";

export const metadata = { title: "Spending · Vendors" };

// Vendors subtab — placeholder surface. The Vendors workflow fills in the
// per-vendor list, lifetime totals, and vendor memory later. SpendingView
// renders the structural shell + VendorIntelligence as a starter so the
// tab isn't empty.
export default async function SpendingVendorsPage() {
  const props = await loadSpendingProps({});
  return <SpendingView {...props} tab="vendors" />;
}
