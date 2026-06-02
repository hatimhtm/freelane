import { PaymentsView } from "../_components/payments-view";
import { loadPaymentsProps } from "../_components/payments-data";

export const metadata = { title: "Payments · History" };

export default async function PaymentsHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; project?: string }>;
}) {
  const params = await searchParams;
  const props = await loadPaymentsProps(params);
  return <PaymentsView {...props} tab="history" />;
}
