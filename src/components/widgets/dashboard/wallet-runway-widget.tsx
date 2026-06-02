"use client";

import { useRouter } from "next/navigation";
import { MWidget } from "@/components/widgets/m-widget";
import { MoneyFlow } from "@/components/ui/money-flow";
import { NumberHero } from "@/components/widgets/number-hero";
import { Stamp } from "@/components/widgets/shapes/stamp";
import type { CurrencyCode } from "@/lib/supabase/types";
import type { HoldingBalanceRow } from "@/lib/payment-chain";

// T30 — Wallet Runway M widget. Hero = days-of-runway. ONE hero shape per
// card (no per-wallet leaderboard inside the M — that's an explicit
// Dashboard anti-pattern). Negative wallets are summarised in a single
// Stamp; the per-wallet detail lives at /payments via the whole-card click.
//
// Icon: deliberately none. Wallet is the locked entity icon and runway is a
// derived metric, not a wallet entity. The "RUNWAY" eyebrow carries the
// label — re-using Wallet here would collide with the entity vocabulary.

type Props = {
  holdings: HoldingBalanceRow[];
  dailyBurnByWallet: Map<string, number>;
  currency: CurrencyCode;
};

export function WalletRunwayWidget({ holdings, dailyBurnByWallet, currency }: Props) {
  const router = useRouter();
  if (holdings.length === 0) return null;
  const totalBalance = holdings.reduce((s, h) => s + h.balance, 0);
  const totalBurn = Array.from(dailyBurnByWallet.values()).reduce((s, v) => s + v, 0);
  const runwayDays = totalBurn > 0 ? totalBalance / totalBurn : Infinity;

  // Overdrawn treatment: if the combined balance has gone past zero the
  // runway number is meaningless. The Stamp carries the "overdrawn" tone
  // and the deficit is the sub-line. (Calm Weather already lands in storm
  // band when this fires; the widget echoes the same signal.)
  const overdrawn = totalBalance < 0;

  const hero = overdrawn ? (
    <span>—</span>
  ) : runwayDays === Infinity ? (
    <span>—</span>
  ) : (
    <NumberHero
      value={Math.max(0, Math.round(runwayDays))}
      suffix="d"
      className="tabular-nums"
    />
  );

  const overOverdraftCount = holdings.filter((h) => h.status === "over_overdraft").length;
  const withinToleranceCount = holdings.filter((h) => h.status === "within_tolerance").length;

  const stampTone: "lime" | "terracotta" | "rose" | "muted" =
    overOverdraftCount > 0
      ? "rose"
      : withinToleranceCount > 0
        ? "terracotta"
        : "lime";
  const stampLabel =
    overOverdraftCount > 0
      ? `${overOverdraftCount} OVERDRAWN`
      : withinToleranceCount > 0
        ? `${withinToleranceCount} TIGHT`
        : "STEADY";

  return (
    <MWidget
      label="Wallet runway"
      eyebrow="RUNWAY"
      hero={hero}
      onOpen={() => router.push("/payments")}
      sub={
        overdrawn ? (
          <span>
            Overdrawn{" "}
            <MoneyFlow value={Math.round(Math.abs(totalBalance))} currency={currency} /> across {holdings.length}{" "}
            wallet{holdings.length === 1 ? "" : "s"}
          </span>
        ) : (
          <span>
            <MoneyFlow value={Math.round(totalBalance)} currency={currency} /> across {holdings.length}{" "}
            wallet{holdings.length === 1 ? "" : "s"}
          </span>
        )
      }
      supporting={<Stamp tone={stampTone}>{stampLabel}</Stamp>}
      tone={overOverdraftCount > 0 ? "rose" : withinToleranceCount > 0 ? "terracotta" : "default"}
      aiDot={{
        key: "money.wallet_runway",
        label: "Wallet runway",
        data: {
          totalBalance,
          totalBurn,
          runwayDays: runwayDays === Infinity ? null : runwayDays,
          overdrawn,
          overOverdraftCount,
          withinToleranceCount,
          walletCount: holdings.length,
        },
      }}
    />
  );
}
