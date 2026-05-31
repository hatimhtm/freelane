import { getShouldIBuySessions } from "@/lib/data/queries";
import { BASE_CURRENCY_FALLBACK } from "@/lib/constants";
import { ShouldIBuyView } from "./_components/should-i-buy-view";

export const metadata = { title: "Should I buy this?" };

export default async function ShouldIBuyPage() {
  const sessions = await getShouldIBuySessions(30);
  return <ShouldIBuyView sessions={sessions} baseCurrency={BASE_CURRENCY_FALLBACK} />;
}
