"use client";

import NumberFlow from "@number-flow/react";
import { motion } from "motion/react";
import {
  AreaChart,
  Area,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { ArrowUpRight, Clock, TrendingUp, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

type Props = {
  baseCurrency: CurrencyCode;
  totalEarnedYTD: number;
  outstanding: number;
  overdue: number;
  next30: number;
  monthlyRevenue: { month: string; total: number }[];
  clientDistribution: { name: string; value: number }[];
  recentPayments: {
    id: string;
    amount: number;
    currency: CurrencyCode;
    paid_at: string;
    project_title: string;
    client_name: string;
  }[];
};

const PIE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export function DashboardStats({
  baseCurrency,
  totalEarnedYTD,
  outstanding,
  overdue,
  next30,
  monthlyRevenue,
  clientDistribution,
  recentPayments,
}: Props) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <HeroPending value={outstanding} currency={baseCurrency} />
        <SecondaryStat
          label="Earned this year"
          value={totalEarnedYTD}
          currency={baseCurrency}
          icon={TrendingUp}
          tone="brand"
          delay={0.04}
        />
        <SecondaryStat
          label="Overdue"
          value={overdue}
          currency={baseCurrency}
          icon={AlertCircle}
          tone="rose"
          delay={0.06}
        />
        <SecondaryStat
          label="Due in 30 days"
          value={next30}
          currency={baseCurrency}
          icon={Clock}
          tone="amber"
          delay={0.08}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="lg:col-span-2"
        >
          <Card className="overflow-hidden">
            <div className="flex items-baseline justify-between p-6 pb-2">
              <div>
                <div className="text-sm font-medium text-muted-foreground">Revenue</div>
                <div className="text-xs text-muted-foreground/70">
                  Last 6 months, converted to {baseCurrency}
                </div>
              </div>
            </div>
            <div className="h-72 px-2 pb-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyRevenue} margin={{ left: 16, right: 16, top: 8 }}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeOpacity={0.4} vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
                  />
                  <Tooltip
                    cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
                    content={<ChartTooltip currency={baseCurrency} />}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    stroke="var(--chart-1)"
                    strokeWidth={2}
                    fill="url(#rev)"
                    dot={{ stroke: "var(--chart-1)", strokeWidth: 2, fill: "var(--background)", r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.12 }}
        >
          <Card className="h-full p-6">
            <div className="text-sm font-medium text-muted-foreground">Top clients</div>
            <div className="text-xs text-muted-foreground/70">By paid amount</div>
            {clientDistribution.length === 0 ? (
              <div className="mt-10 text-center text-sm text-muted-foreground">No paid invoices yet.</div>
            ) : (
              <>
                <div className="mt-2 h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={clientDistribution}
                        innerRadius={40}
                        outerRadius={68}
                        paddingAngle={2}
                        dataKey="value"
                        stroke="var(--background)"
                        strokeWidth={2}
                      >
                        {clientDistribution.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip currency={baseCurrency} />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {clientDistribution.map((c, i) => (
                    <li key={c.name} className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                        />
                        <span className="truncate">{c.name}</span>
                      </span>
                      <span className="tabular text-muted-foreground">
                        {formatMoney(c.value, baseCurrency, { compact: true })}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.14 }}
      >
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Recent payments</div>
              <div className="text-xs text-muted-foreground">Last {recentPayments.length} received</div>
            </div>
          </div>
          {recentPayments.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No payments logged yet.
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {recentPayments.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm font-medium">{p.project_title}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.client_name} · {new Date(p.paid_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-sm font-medium tabular">
                    <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500" />
                    {formatMoney(p.amount, p.currency)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </motion.div>
    </div>
  );
}

function HeroPending({ value, currency }: { value: number; currency: CurrencyCode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="group relative h-full overflow-hidden border-[var(--brand)]/30 p-6">
        <div className="pointer-events-none absolute inset-0 brand-glow-strong opacity-80" />
        <div className="relative">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand)] animate-pulse" />
            Pending · money you're owed
          </div>
          <div className="mt-3 text-[44px] font-semibold leading-none tracking-tight tabular">
            <NumberFlow
              value={value}
              format={{
                style: "currency",
                currency: currency === "PHP" ? "PHP" : currency,
                maximumFractionDigits: 0,
              }}
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Every unpaid balance, converted to {currency} at your rates.
          </p>
        </div>
      </Card>
    </motion.div>
  );
}

function SecondaryStat({
  label,
  value,
  currency,
  icon: Icon,
  tone,
  delay = 0,
}: {
  label: string;
  value: number;
  currency: CurrencyCode;
  icon: React.ComponentType<{ className?: string }>;
  tone: "brand" | "cyan" | "amber" | "rose";
  delay?: number;
}) {
  const toneStyles = {
    brand: "from-[var(--chart-1)] to-[var(--chart-1)]/60",
    cyan:  "from-[var(--chart-2)] to-[var(--chart-2)]/60",
    amber: "from-[var(--chart-3)] to-[var(--chart-3)]/60",
    rose:  "from-[var(--chart-4)] to-[var(--chart-4)]/60",
  }[tone];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
    >
      <Card className="group relative h-full overflow-hidden p-5">
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 -top-px h-px bg-gradient-to-r opacity-60 transition-opacity group-hover:opacity-100",
            toneStyles,
          )}
        />
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {label}
            </div>
            <div className="mt-2 text-[24px] font-semibold tracking-tight tabular">
              <NumberFlow
                value={value}
                format={{
                  style: "currency",
                  currency: currency === "PHP" ? "PHP" : currency,
                  maximumFractionDigits: 0,
                }}
              />
            </div>
          </div>
          <div
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-white shadow-sm",
              toneStyles,
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name?: string; payload?: { name?: string; month?: string } }>;
  label?: string;
  currency: CurrencyCode;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const name = item.payload?.name ?? label ?? item.payload?.month ?? "";
  return (
    <div className="glass rounded-lg border border-border/60 px-3 py-2 text-xs shadow-xl">
      <div className="font-medium">{name}</div>
      <div className="mt-0.5 tabular text-muted-foreground">
        {formatMoney(Number(item.value), currency, { compact: true })}
      </div>
    </div>
  );
}
