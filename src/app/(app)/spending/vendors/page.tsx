import { SpendingView } from "../_components/spending-view";
import { loadSpendingProps } from "../_components/spending-data";
import { getVendorsSubviewData } from "@/lib/data/queries";

export const metadata = { title: "Spending · Vendors" };

// Vendors subtab — Vendors workflow surface.
//
// Loads the standard spending props (for shared header/widgets) plus the
// dedicated vendors-subview aggregation. The sub-view does its own
// sorting + filtering client-side; this loader just hands over the
// pre-aggregated rows + the vendor_icon_cache.
export default async function SpendingVendorsPage() {
  const [props, vendorsSubviewData] = await Promise.all([
    loadSpendingProps({}),
    getVendorsSubviewData(),
  ]);
  return (
    <SpendingView
      {...props}
      tab="vendors"
      vendorsSubview={{
        needsIdentification: vendorsSubviewData.needsIdentification,
        active: vendorsSubviewData.active,
        archived: vendorsSubviewData.archived,
      }}
      vendorIconCache={vendorsSubviewData.vendorIconCache}
    />
  );
}
