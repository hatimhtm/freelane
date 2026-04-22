"use client";

import NumberFlow from "@number-flow/react";
import { motion } from "motion/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  Cell,
} from "recharts";
import { ArrowDown, ArrowUp, Flame, Sparkles, Trophy, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/supabase/types";

type Props = {
  year: number;
  baseCurrency: CurrencyCode;
  totalEarned: number;
  totalPrev: number;
  growthPct: number | null;
  projectsCompleted: number;
  clientCount: number;
  monthlyTotals: { month: string; total: number }[];
  busiestMonth: { month: string; total: number };
  topClients: { name: string; total: number }[];
  biggestProject: {
    title: string;
    amount: number;
    currency: CurrencyCode;
    client: string;
  } | null;
};

export function YearInReview({
  year,
  baseCurrency,
  totalEarned,
  growthPct,
  projectsCompleted,
  clientCount,
  monthlyTotals,
  busiestMonth,
  topClients,
  biggestProject,
}: Props) {
  const maxMonth = Math.max(1, ...monthlyTotals.map((m) => m.total));

  return (
    <div className="space-y-6">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Card className="relative overflow-hidden border-[var(--brand)]/30 p-8">
          <div className="pointer-events-none absolute inset-0 brand-glow-strong" />
          <div className="relative">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Total earned in {year}
            </div>
            <div className="mt-3 text-5xl font-semibold leading-none tracking-tight tabular sm:text-6xl">
              <NumberFlow
                value={totalEarned}
                format={{
                  style: "currency",
                  currency: baseCurrency === "PHP" ? "PHP" : baseCurrency,
                  maximumFractionDigits: 0,
                }}
              />
            </div>
            {growthPct !== null && (
              <div
                className={cn(
                  "mt-3 inline-flex items-center gap-1 text-sm font-medium",
                  growthPct >= 0 ? "text-[var(--chart-5)]" : "text-[var(--chart-4)]",
                )}
              >
                {growthPct >= 0 ? (
                  <ArrowUp className="h-3.5 w-3.5" />
                ) : (
                  <ArrowDown className="h-3.5 w-3.5" />
                )}
                <span>
                  {Math.abs(growthPct).toFixed(1)}% vs {year - 1}
                </span>
              </div>
            )}
          </div>
        </Card>
      </motion.div>

      {/* Stat trio */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          icon={Sparkles}
          label="Projects completed"
          value={projectsCompleted}
          tone="brand"
          delay={0.1}
        />
        <StatTile
          icon={Users}
          label="Clients worked with"
          value={clientCount}
          tone="cyan"
          delay={0.15}
        />
        <StatTile
          icon={Flame}
          label="Busiest month"
          text={busiestMonth.month}
          subtext={formatMoney(busiestMonth.total, baseCurrency, { compact: true })}
          tone="amber"
          delay={0.2}
        />
      </div>

      {/* Monthly bar chart */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.25 }}
      >
        <Card className="overflow-hidden p-6">
          <div className="mb-4">
            <div className="text-sm font-medium">Month by month</div>
            <div className="text-xs text-muted-foreground">Totals in {baseCurrency}</div>
          </div>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyTotals} margin={{ left: 4, right: 4, top: 4 }}>
                <defs>
                  <linearGradient id="barG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={1} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.45} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" strokeOpacity={0.4} vertical={false} />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                />
                <Tooltip
                  cursor={{ fill: "oklch(from var(--foreground) l c h / 0.04)" }}
                  content={<BarTooltip currency={baseCurrency} />}
                />
                <Bar dataKey="total" radius={[6, 6, 0, 0]} fill="url(#barG)">
                  {monthlyTotals.map((m, i) => (
                    <Cell
                      key={i}
                      fill={m.total === maxMonth && m.total > 0 ? "var(--chart-3)" : "url(#barG)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </motion.div>

      {/* Top clients + biggest project */}
      <div className="grid gap-4 lg:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
        >
          <Card className="h-full p-6">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Trophy className="h-4 w-4 text-[var(--chart-3)]" />
              Top clients
            </div>
            {topClients.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No payments received this year.
              </div>
            ) : (
              <ol className="space-y-2.5">
                {topClients.map((c, i) => {
                  const pct = (c.total / Math.max(1, topClients[0].total)) * 100;
                  return (
                    <li key={c.name}>
                      <div className="mb-1 flex items-baseline justify-between">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted font-mono text-[10px] text-muted-foreground">
                            {i + 1}
                          </span>
                          <span className="truncate font-medium">{c.name}</span>
                        </div>
                        <div className="shrink-0 text-sm tabular text-muted-foreground">
                          {formatMoney(c.total, baseCurrency, { compact: true })}
                        </div>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.8, delay: 0.4 + i * 0.08, ease: [0.2, 0.9, 0.3, 1] }}
                          className="h-full rounded-full bg-gradient-to-r from-[var(--chart-1)] to-[var(--chart-2)]"
                        />
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.35 }}
        >
          <Card className="h-full overflow-hidden p-6">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Biggest project
            </div>
            {biggestProject ? (
              <>
                <div className="mt-3 line-clamp-2 text-xl font-semibold leading-tight tracking-tight">
                  {biggestProject.title}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {biggestProject.client}
                </div>
                <div className="mt-6 bg-gradient-to-r from-[var(--brand)] to-[#5b9dff] bg-clip-text text-4xl font-semibold tabular tracking-tight text-transparent">
                  {formatMoney(biggestProject.amount, biggestProject.currency)}
                </div>
              </>
            ) : (
              <div className="mt-8 text-center text-sm text-muted-foreground">
                No projects touched this year yet.
              </div>
            )}
          </Card>
        </motion.div>
      </div>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  text,
  subtext,
  tone,
  delay = 0,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: number;
  text?: string;
  subtext?: string;
  tone: "brand" | "cyan" | "amber";
  delay?: number;
}) {
  const toneClass = {
    brand: "from-[var(--chart-1)] to-[var(--chart-1)]/60",
    cyan: "from-[var(--chart-2)] to-[var(--chart-2)]/60",
    amber: "from-[var(--chart-3)] to-[var(--chart-3)]/60",
  }[tone];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
    >
      <Card className="group relative h-full overflow-hidden p-5">
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 -top-px h-px bg-gradient-to-r opacity-70",
            toneClass,
          )}
        />
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {label}
            </div>
            {value !== undefined ? (
              <div className="mt-2 text-3xl font-semibold tabular tracking-tight">
                <NumberFlow value={value} />
              </div>
            ) : (
              <>
                <div className="mt-2 text-2xl font-semibold tracking-tight">{text}</div>
                {subtext && (
                  <div className="mt-0.5 text-xs tabular text-muted-foreground">{subtext}</div>
                )}
              </>
            )}
          </div>
          <div
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-white shadow-sm",
              toneClass,
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

function BarTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
  currency: CurrencyCode;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass rounded-lg border border-border/60 px-3 py-2 text-xs shadow-xl">
      <div className="font-medium">{label}</div>
      <div className="mt-0.5 tabular text-muted-foreground">
        {formatMoney(Number(payload[0].value), currency, { compact: true })}
      </div>
    </div>
  );
}
