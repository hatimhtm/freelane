import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { HoldingBalanceRow } from "@/lib/payment-chain";

// T13 — tri-state minus-money treatment. Only over-overdraft wallets raise
// the alarm in rose. within-tolerance wallets render as terracotta inside
// the wallet stack itself; they don't surface here.
//
// Locked tokens only: rounded-xl + ring-1 rose-500 (no --overdue alias, no
// bespoke 2xl radius). Rose comes from the standard ring slot to match the
// MWidget/SWidget rose tone used everywhere else for the "alarm" signal.
export function NegativeWalletAlarm({ holdings }: { holdings: HoldingBalanceRow[] }) {
  const negatives = holdings.filter((h) => h.status === "over_overdraft");
  if (negatives.length === 0) return null;

  const summary = negatives
    .map((h) => `${h.name} − ${formatMoney(Math.abs(h.balance), "PHP", { compact: true })}`)
    .join(" · ");

  return (
    <section
      aria-label="Wallet balance check"
      className="rounded-xl bg-card p-5 ring-1 ring-rose-500/30"
    >
      <h2 className="text-base font-medium text-foreground">Some wallets look off</h2>
      <p className="mt-1 text-sm text-muted-foreground tabular-nums">{summary}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link
          href="/payments"
          className="inline-flex h-9 items-center rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-colors duration-300 ease-out hover:bg-foreground/85"
        >
          Log a payment
        </Link>
        <Link
          href="/settings"
          className="inline-flex h-9 items-center rounded-lg ring-1 ring-foreground/15 px-4 text-sm font-medium text-foreground transition-colors duration-300 ease-out hover:ring-foreground/40"
        >
          Set opening balance
        </Link>
      </div>
    </section>
  );
}
