"use client";

import { useRouter } from "next/navigation";
import { ArrowDownLeft } from "lucide-react";
import { SWidget } from "@/components/widgets/s-widget";
import { NumberHero } from "@/components/widgets/number-hero";
import type { CurrencyCode } from "@/lib/supabase/types";
import { formatMoney } from "@/lib/money";

type Props = {
  count: number;
  totalDueBase: number;
  currency: CurrencyCode;
};

export function OpenPaymentsWidget({ count, totalDueBase, currency }: Props) {
  const router = useRouter();
  return (
    <SWidget
      label="Open payments"
      icon={<ArrowDownLeft className="h-4 w-4" />}
      hero={<NumberHero value={count} maximumFractionDigits={0} />}
      sub={<span>{formatMoney(totalDueBase, currency, { compact: true })} due</span>}
      aiDot={{ key: "commitments.open_payments", label: "Open payments" }}
      onOpen={() => router.push("/payments")}
    />
  );
}
