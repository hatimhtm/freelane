"use client";

import type { SadakaLedgerRow } from "@/lib/sadaka/ledger";
import type { CurrencyCode } from "@/lib/supabase/types";

// RHYTHM (S): monthly given sparkline over last 6 PHT months. Pure SVG, no
// chart library. Sums payment + auto_detected ledger rows (their amount_base
// is negative) per calendar month and plots absolute values.

type Props = {
  events: SadakaLedgerRow[];
  currency: CurrencyCode;
};

function monthKeyPht(d: Date): string {
  const local = new Date(
    d.toLocaleString("en-US", { timeZone: "Asia/Manila" }),
  );
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function lastSixMonths(now: Date): string[] {
  const out: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i);
    out.push(monthKeyPht(d));
  }
  return out;
}

export function SadakaRhythm({ events, currency }: Props) {
  const now = new Date();
  const months = lastSixMonths(now);
  const byMonth = new Map<string, number>();
  for (const m of months) byMonth.set(m, 0);

  for (const ev of events) {
    if (ev.kind !== "payment" && ev.kind !== "auto_detected") continue;
    const key = monthKeyPht(new Date(ev.event_at));
    if (!byMonth.has(key)) continue;
    byMonth.set(key, (byMonth.get(key) ?? 0) + Math.abs(Number(ev.amount_base)));
  }
  const series = months.map((m) => byMonth.get(m) ?? 0);
  const peak = Math.max(...series, 1);
  const total = series.reduce((s, v) => s + v, 0);

  // 96 x 32 sparkline, padded.
  const w = 96;
  const h = 32;
  const points = series
    .map((v, i) => {
      const x = (i / Math.max(1, series.length - 1)) * w;
      const y = h - (v / peak) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const last = series[series.length - 1] ?? 0;
  const prev = series[series.length - 2] ?? 0;
  const deltaLabel =
    prev === 0
      ? "first month with movement"
      : last > prev
        ? `${currency} ${Math.round(last - prev)} above last month`
        : last < prev
          ? `${currency} ${Math.round(prev - last)} below last month`
          : "even with last month";

  return (
    <div
      data-slot="card"
      className="flex aspect-square w-full min-h-[160px] flex-col justify-between rounded-xl bg-card p-4 ring-1 ring-foreground/10"
    >
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Rhythm
        </div>
        <div className="text-[10px] text-muted-foreground/70">6 months</div>
      </div>

      <div className="flex-1 pt-3">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          width="100%"
          height="32"
          preserveAspectRatio="none"
          aria-hidden
        >
          <polyline
            points={points}
            fill="none"
            stroke="oklch(0.62 0.16 35)"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      <div>
        <div className="display-headline text-[20px] leading-none tabular-nums text-foreground">
          {currency} {Math.round(total)}
        </div>
        <div className="text-[11px] leading-tight text-muted-foreground">{deltaLabel}</div>
      </div>
    </div>
  );
}
