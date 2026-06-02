import { PaymentsView } from "../_components/payments-view";
import { loadPaymentsProps } from "../_components/payments-data";

export const metadata = { title: "Payments · Wallets" };

export default async function PaymentsWalletsPage({
  searchParams,
}: {
  searchParams: Promise<{ withdraw?: string }>;
}) {
  const params = await searchParams;
  const props = await loadPaymentsProps(params);
  return <PaymentsView {...props} tab="wallets" />;
}
