import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { HoldingBalanceRow } from "@/lib/payment-chain";

export function NegativeWalletAlarm({ holdings }: { holdings: HoldingBalanceRow[] }) {
  const negatives = holdings.filter((h) => h.balance < 0);
  if (negatives.length === 0) return null;

  const summary = negatives
    .map((h) => `${h.name} − ${formatMoney(Math.abs(h.balance), "PHP", { compact: true })}`)
    .join(" · ");

  return (
    <section
      aria-label="Wallet balance check"
      className="rounded-2xl border border-ink/10 border-l-2 border-l-[var(--overdue)] bg-paper p-7"
    >
      <h2 className="text-base font-medium text-ink">Some wallets look off</h2>
      <p className="mt-1 text-sm text-ink/60 tabular">{summary}</p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link
          href="/payments"
          className="inline-flex h-9 items-center rounded-lg bg-ink px-4 text-sm font-medium text-paper transition-colors duration-300 ease-out hover:bg-ink/85"
        >
          Log a payment
        </Link>
        <Link
          href="/settings"
          className="inline-flex h-9 items-center rounded-lg border border-ink/15 px-4 text-sm font-medium text-ink transition-colors duration-300 ease-out hover:border-ink/40"
        >
          Set opening balance
        </Link>
      </div>
    </section>
  );
}
