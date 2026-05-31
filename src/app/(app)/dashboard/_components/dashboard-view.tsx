"use client";

import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CalendarRange,
  CircleHelp,
  Layers,
  Plus,
  Receipt,
  Users,
  Wallet,
} from "lucide-react";
import { motion } from "motion/react";
import { LinkButton } from "@/components/ui/link-button";
import { EmptyState } from "@/components/app/empty-state";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/supabase/types";

// ─────────────────────────────────────────────────────────── DENSITY NOTE ──
// Bird's-eye dashboard, small-window-first. Everything here is a SUMMARY —
// detail lives on /spending /payments /clients /projects. No leaderboards,
// no detailed lists, no big charts. Glanceable in 2-3 seconds.

const EASE = [0.22, 1, 0.36, 1] as const;

type AlertRow =
  | { kind: "negative-wallet"; name: string; deficit: number; href: string }
  | { kind: "recurring-due"; label: string; daysUntil: number; expectedBase: number; currency: CurrencyCode; href: string }
  | { kind: "ai-questions"; count: number; preview: string | null; href: string };

export function DashboardView({
  firstName,
  currency,
  hasClients,
  year,
  // hero strip
  landedMtd,
  spentMtd,
  feesMtd,
  outstandingTotal,
  walletTotal,
  safeToday,
  // sparkline
  landedSeries,
  spentSeries,
  // alerts
  alerts,
}: {
  firstName: string | null;
  currency: CurrencyCode;
  hasClients: boolean;
  year: number;
  landedMtd: number;
  spentMtd: number;
  feesMtd: number;
  outstandingTotal: number;
  walletTotal: number;
  safeToday: number;
  landedSeries: number[];
  spentSeries: number[];
  alerts: AlertRow[];
}) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {/* Header — tight */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-medium tracking-tight md:text-2xl">
            {firstName ? `Hey, ${firstName}.` : "Dashboard"}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {new Date().toLocaleString("en", { month: "long", year: "numeric" })} at a glance.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <LinkButton href={`/year/${year}`} variant="ghost" size="sm">
            <CalendarRange className="mr-1 h-3.5 w-3.5" />
            {year}
          </LinkButton>
          <LinkButton href={hasClients ? "/payments?new=1" : "/clients?new=1"} size="sm">
            <Plus className="mr-1 h-3.5 w-3.5" />
            {hasClients ? "Log payment" : "Add client"}
          </LinkButton>
        </div>
      </div>

      {!hasClients ? (
        <div className="mt-6">
          <EmptyState
            icon={Users}
            title="No clients yet."
            description="Add a client and a project. Payments show up here once they land."
            action={<LinkButton href="/clients?new=1">Add a client</LinkButton>}
          />
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          {/* Hero strip — six stats */}
          <HeroStrip
            currency={currency}
            items={[
              { label: "Landed", value: landedMtd, tone: "pos" },
              { label: "Spent", value: spentMtd, tone: "neg" },
              { label: "Fees", value: feesMtd, tone: "warn" },
              { label: "Outstanding", value: outstandingTotal, tone: "muted" },
              { label: "Wallets", value: walletTotal, tone: "muted" },
              { label: "Safe today", value: safeToday, tone: "pos", accent: true },
            ]}
          />

          {/* Pulse — landed + spent over 30 days */}
          <PulseStrip landedSeries={landedSeries} spentSeries={spentSeries} currency={currency} />

          {/* Alerts — only render if there is at least one */}
          {alerts.length > 0 && <Alerts rows={alerts} currency={currency} />}

          {/* Jump-to nav */}
          <JumpTo />
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────── HERO STRIP ──

function HeroStrip({
  items,
  currency,
}: {
  items: { label: string; value: number; tone: "pos" | "neg" | "warn" | "muted"; accent?: boolean }[];
  currency: CurrencyCode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE }}
      className="grid grid-cols-2 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 sm:grid-cols-3 lg:grid-cols-6"
    >
      {items.map((it, i) => (
        <div
          key={it.label}
          className={cn(
            "relative px-3 py-3 sm:px-4",
            // hairline dividers between cells
            i < items.length - 1 && "after:absolute after:right-0 after:top-3 after:bottom-3 after:hidden after:w-px after:bg-foreground/10 lg:after:block",
            i % 2 === 1 && "border-l border-foreground/10 lg:border-l-0",
            i >= 2 && "border-t border-foreground/10 sm:border-t-0",
            i >= 3 && i % 3 !== 0 && "sm:border-l sm:border-foreground/10 lg:border-l-0",
            i === 3 && "sm:border-t sm:border-foreground/10 lg:border-t-0",
            it.accent && "bg-foreground/[0.025]",
          )}
        >
          <div className="display-eyebrow text-[10px] text-muted-foreground">{it.label}</div>
          <div
            className={cn(
              "mt-1 font-heading text-lg font-medium tracking-tight tabular leading-none",
              it.tone === "pos" && "text-foreground",
              it.tone === "neg" && "text-foreground",
              it.tone === "warn" && "text-foreground",
              it.tone === "muted" && "text-foreground",
            )}
          >
            {formatMoney(it.value, currency, { compact: true })}
          </div>
        </div>
      ))}
    </motion.section>
  );
}

// ───────────────────────────────────────────────────────── 30-DAY PULSE ──

function PulseStrip({
  landedSeries,
  spentSeries,
  currency,
}: {
  landedSeries: number[];
  spentSeries: number[];
  currency: CurrencyCode;
}) {
  const landedTotal = landedSeries.reduce((s, v) => s + v, 0);
  const spentTotal = spentSeries.reduce((s, v) => s + v, 0);
  const net = landedTotal - spentTotal;
  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: 0.04, ease: EASE }}
      className="rounded-xl bg-card ring-1 ring-foreground/10"
    >
      <div className="flex items-end justify-between gap-3 px-4 pt-3">
        <div className="flex items-center gap-4 text-[11px]">
          <Legend swatch="var(--chart-1)" label="Landed" value={landedTotal} currency={currency} />
          <Legend swatch="var(--chart-4)" label="Spent" value={spentTotal} currency={currency} />
        </div>
        <div className="text-right">
          <div className="display-eyebrow text-[10px] text-muted-foreground">30-day net</div>
          <div className={cn(
            "font-heading text-sm font-medium tabular tracking-tight",
            net < 0 ? "text-[var(--overdue)]" : "text-[var(--success)]",
          )}>
            {net < 0 ? "−" : "+"}{formatMoney(Math.abs(net), currency, { compact: true })}
          </div>
        </div>
      </div>
      <div className="relative px-2 pb-2 pt-1">
        <DualSparkline landed={landedSeries} spent={spentSeries} />
      </div>
    </motion.section>
  );
}

function Legend({
  swatch,
  label,
  value,
  currency,
}: {
  swatch: string;
  label: string;
  value: number;
  currency: CurrencyCode;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span aria-hidden className="inline-block size-1.5 translate-y-[-1px] rounded-full" style={{ background: swatch }} />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-heading text-sm tabular text-foreground">
        {formatMoney(value, currency, { compact: true })}
      </span>
    </span>
  );
}

// Single SVG with two overlaid lines, shared y-axis so the relative magnitude
// reads honestly. Sparkline component handles in-view stroke-draw animation;
// we mimic the same visual contract here with two simple paths.
function DualSparkline({ landed, spent }: { landed: number[]; spent: number[] }) {
  const length = Math.max(landed.length, spent.length);
  if (length < 2) return <div className="h-12" />;
  // Pad either array to match length (front-pad with zeros for stability).
  const L = padFront(landed, length);
  const S = padFront(spent, length);
  const max = Math.max(...L, ...S, 1);
  const min = 0;
  const width = 600;
  const height = 48;
  const pad = 3;
  const usable = height - pad * 2;
  const stepX = width / (length - 1);

  const toPath = (data: number[]) => {
    const pts = data.map((v, i) => {
      const x = i * stepX;
      const y = pad + usable - ((v - min) / (max - min || 1)) * usable;
      return [x, y] as const;
    });
    return smoothPath(pts);
  };

  const landedPath = toPath(L);
  const spentPath = toPath(S);

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
      className="block"
    >
      <defs>
        <linearGradient id="dash-landed-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.14} />
          <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${landedPath} L${width},${height} L0,${height} Z`} fill="url(#dash-landed-fill)" />
      <path d={landedPath} fill="none" stroke="var(--chart-1)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <path d={spentPath} fill="none" stroke="var(--chart-4)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 2" opacity={0.85} />
    </svg>
  );
}

function padFront(arr: number[], length: number): number[] {
  if (arr.length >= length) return arr;
  return [...new Array(length - arr.length).fill(0), ...arr];
}

function smoothPath(points: readonly (readonly [number, number])[]): string {
  if (points.length < 2) return "";
  const t = 0.3;
  const d = [`M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    const c1y = p1[1] + (p2[1] - p0[1]) * t;
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    const c2y = p2[1] - (p3[1] - p1[1]) * t;
    d.push(`C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`);
  }
  return d.join(" ");
}

// ──────────────────────────────────────────────────────────── ALERTS BAND ──

function Alerts({ rows, currency }: { rows: AlertRow[]; currency: CurrencyCode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: 0.08, ease: EASE }}
      className="overflow-hidden rounded-xl border-l-2 border-l-[var(--overdue)]/70 bg-card ring-1 ring-foreground/10"
    >
      <div className="flex items-center gap-2 border-b border-foreground/10 px-3 py-2">
        <AlertCircle className="size-3.5 text-[var(--overdue)]" />
        <div className="text-xs font-medium tracking-tight">Needs your attention</div>
        <div className="ml-auto text-[10px] text-muted-foreground tabular">{rows.length}</div>
      </div>
      <ul>
        {rows.map((row, i) => (
          <li key={`${row.kind}-${i}`}>
            <Link
              href={row.href}
              className={cn(
                "flex min-h-10 items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-foreground/[0.03]",
                i < rows.length - 1 && "border-b border-foreground/10",
              )}
            >
              <AlertIcon kind={row.kind} />
              <AlertLabel row={row} currency={currency} />
              <ArrowRight className="ml-auto size-3 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}

function AlertIcon({ kind }: { kind: AlertRow["kind"] }) {
  const Icon = kind === "negative-wallet" ? Wallet : kind === "recurring-due" ? Receipt : CircleHelp;
  return (
    <span className="grid size-5 shrink-0 place-items-center rounded-md bg-foreground/[0.06]">
      <Icon className="size-3 text-muted-foreground" />
    </span>
  );
}

function AlertLabel({ row, currency }: { row: AlertRow; currency: CurrencyCode }) {
  if (row.kind === "negative-wallet") {
    return (
      <span className="min-w-0 truncate">
        <span className="font-medium">{row.name}</span>{" "}
        <span className="text-muted-foreground">is short</span>{" "}
        <span className="tabular text-[var(--overdue)]">
          {formatMoney(row.deficit, currency, { compact: true })}
        </span>
      </span>
    );
  }
  if (row.kind === "recurring-due") {
    const when =
      row.daysUntil === 0 ? "today" : row.daysUntil === 1 ? "tomorrow" : `in ${row.daysUntil}d`;
    return (
      <span className="min-w-0 truncate">
        <span className="font-medium">{row.label}</span>{" "}
        <span className="text-muted-foreground">due {when} ·</span>{" "}
        <span className="tabular">{formatMoney(row.expectedBase, row.currency ?? currency, { compact: true })}</span>
      </span>
    );
  }
  return (
    <span className="min-w-0 truncate">
      <span className="font-medium">
        {row.count} open question{row.count === 1 ? "" : "s"}
      </span>
      {row.preview && <span className="text-muted-foreground"> · {row.preview}</span>}
    </span>
  );
}

// ────────────────────────────────────────────────────────────── JUMP TO ──

function JumpTo() {
  const items: { label: string; href: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { label: "Spending", href: "/spending", icon: Receipt },
    { label: "Payments", href: "/payments", icon: Layers },
    { label: "Clients", href: "/clients", icon: Users },
    { label: "Projects", href: "/projects", icon: Layers },
  ];
  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: 0.12, ease: EASE }}
      className="grid grid-cols-2 gap-2 sm:grid-cols-4"
    >
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          className="group/jump flex items-center justify-between rounded-lg bg-card px-3 py-2.5 ring-1 ring-foreground/10 transition-colors hover:ring-foreground/25"
        >
          <span className="inline-flex items-center gap-2 text-xs font-medium">
            <it.icon className="size-3.5 text-muted-foreground" />
            {it.label}
          </span>
          <ArrowRight className="size-3 text-muted-foreground transition-transform group-hover/jump:translate-x-0.5" />
        </Link>
      ))}
    </motion.section>
  );
}

export type { AlertRow };
