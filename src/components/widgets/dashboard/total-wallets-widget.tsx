"use client";

import { Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { SWidget } from "@/components/widgets/s-widget";
import { NumberHero } from "@/components/widgets/number-hero";
import { WarningPill } from "@/components/widgets/warning-pill";
import type { CurrencyCode } from "@/lib/supabase/types";
import { formatMoney } from "@/lib/money";

// /dashboard/money — sum of all wallet balances. Hero = total, sub = 7d
// delta. Reads from the canonical ledger via DashboardProps.

type Props = {
  totalBase: number;
  delta7dBase: number;
  currency: CurrencyCode;
  warning?: string | null;
  warningHref?: string | null;
};

export function TotalWalletsWidget({
  totalBase,
  delta7dBase,
  currency,
  warning,
  warningHref,
}: Props) {
  const router = useRouter();
  return (
    <SWidget
      label="Total wallets"
      icon={<Wallet className="h-4 w-4" />}
      hero={<NumberHero value={totalBase} maximumFractionDigits={0} />}
      sub={
        <span>
          {delta7dBase >= 0 ? "+" : "−"}
          {formatMoney(Math.abs(delta7dBase), currency, { compact: true })} last 7d
        </span>
      }
      warning={
        warning ? (
          <WarningPill detailHref={warningHref ?? "/settings"}>{warning}</WarningPill>
        ) : undefined
      }
      aiDot={{
        key: "money.total_wallets",
        label: "Total wallets",
        data: { totalBase, delta7dBase },
      }}
      onOpen={() => router.push("/settings")}
    />
  );
}
