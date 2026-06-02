"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Clock,
  Plus,
  Target,
  Users,
  Wallet,
} from "lucide-react";
import { motion } from "motion/react";
import { LinkButton } from "@/components/ui/link-button";
import { EmptyState } from "@/components/app/empty-state";
import { CalmWeatherBanner } from "@/components/app/calm-weather-banner";
import { ForecastStoryCard } from "@/components/app/forecast-story-card";
import { NegativeWalletAlarm } from "@/components/app/negative-wallet-alarm";
import { CashflowAtlasChart } from "@/components/spending/cashflow-atlas-chart";
import { IncomeStrip } from "@/components/widgets/dashboard/income-strip";
import { PackRhythmWidget } from "@/components/widgets/dashboard/pack-rhythm-widget";
import { NightSpendsRemark } from "@/components/widgets/dashboard/night-spends-remark";
import { WalletRunwayWidget } from "@/components/widgets/dashboard/wallet-runway-widget";
import { MWidget } from "@/components/widgets/m-widget";
import { Stamp } from "@/components/widgets/shapes/stamp";
import { MoneyFlow } from "@/components/ui/money-flow";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CalmWeatherState, CurrencyCode } from "@/lib/supabase/types";
import type { CashflowAtlas } from "@/lib/cashflow-atlas";
import type { ForecastStory } from "@/lib/ai/forecast-storyteller";
import type { HoldingBalanceRow } from "@/lib/payment-chain";
import type { PackRhythmRead } from "@/lib/ai/pack-rhythm";
import type { LateNightClusterRead } from "@/lib/ai/late-night-cluster";

// ─────────────────────────────────────────────────────────── DENSITY NOTE ──
// Bird's-eye dashboard, small-window-first. Everything here is a SUMMARY —
// detail lives on /spending /payments /clients /projects. No leaderboards,
// no detailed lists, no big charts. Glanceable in 2-3 seconds.

const EASE = [0.22, 1, 0.36, 1] as const;

type AlertRow =
  | { kind: "negative-wallet"; name: string; deficit: number; href: string }
  | { kind: "recurring-due"; label: string; daysUntil: number; expectedBase: number; currency: CurrencyCode; href: string }
  | { kind: "ai-questions"; count: number; preview: string | null; href: string };

// Per-kind alert glyph — strictly from the locked symbol vocabulary so the
// alert row reads consistently with every other surface (Wallet for the
// wallet entity, Clock for time-anchored due dates). AI questions don't have
// a canonical glyph yet; the count + label do the work without an icon (a
// small ink dot stays neutral — no vocabulary erosion).
function alertGlyph(kind: AlertRow["kind"]) {
  if (kind === "negative-wallet") return <Wallet className="h-3 w-3 text-muted-foreground" />;
  if (kind === "recurring-due") return <Clock className="h-3 w-3 text-muted-foreground" />;
  return <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" aria-hidden />;
}

export function DashboardView({
  firstName,
  currency,
  hasClients,
  year,
  // hero strip
  landedMtd,
  spentMtd: _spentMtd,
  feesMtd,
  outstandingTotal,
  walletTotal,
  safeToday,
  // sparkline
  landedSeries,
  spentSeries,
  // alerts
  alerts,
  calmWeather,
  atlas,
  forecastStory,
  holdings = [],
  dailyBurnByWallet = [],
  weekLanded = 0,
  avgDaysToPayment = null,
  biggestDebtor = null,
  ytd = 0,
  trailing30 = 0,
  packRhythm = null,
  lateNight = null,
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
  calmWeather: CalmWeatherState | null;
  atlas: CashflowAtlas | null;
  forecastStory: ForecastStory | null;
  holdings?: HoldingBalanceRow[];
  dailyBurnByWallet?: Array<[string, number]>;
  weekLanded?: number;
  avgDaysToPayment?: number | null;
  biggestDebtor?: { name: string; total: number } | null;
  ytd?: number;
  trailing30?: number;
  packRhythm?: PackRhythmRead | null;
  lateNight?: LateNightClusterRead | null;
}) {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {/* Header — tight */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display-headline text-3xl md:text-4xl">
            {firstName ? `Hey, ${firstName}.` : "Dashboard"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {new Date().toLocaleString("en", { month: "long", year: "numeric" })} at a glance.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Calendar isn't in the locked vocabulary; the year number itself
              carries the navigation identity (text-only, per the widget-system
              "drop the icon and let typography do the work" option). */}
          <LinkButton href={`/year/${year}`} variant="ghost" size="sm">
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
          {/* Calm Weather Mode — same line the Today page shows. */}
          {calmWeather && (
            <CalmWeatherBanner state={calmWeather} variant="dashboard" />
          )}
          <NegativeWalletAlarm holdings={holdings} />

          {/* Hero — single MWidget carrying the page headline (Safe today).
              The other five numbers from the old HeroStrip live in the
              IncomeStrip + WalletRunwayWidget below, so HeroStrip would
              just have been a fancier copy. */}
          <MWidget
            label="Safe today"
            eyebrow="SAFE TODAY"
            hero={<MoneyFlow value={safeToday} currency={currency} />}
            sub={
              <span>
                of {formatMoney(walletTotal, currency, { compact: true })} across wallets
              </span>
            }
            supporting={<Stamp tone="lime">STEADY</Stamp>}
            live
            onOpen={() => router.push("/spending")}
          />

          {/* 90-Day Cashflow Atlas — bird's-eye projection. */}
          {atlas && (
            <CashflowAtlasChart
              atlas={atlas}
              baseCurrency={currency}
              headline={forecastStory?.headline}
              narrative={forecastStory?.narrative}
            />
          )}

          {/* Pulse — landed + spent over 30 days */}
          <PulseStrip landedSeries={landedSeries} spentSeries={spentSeries} currency={currency} />

          {/* Forecast Storyteller — quiet narrative card. */}
          {forecastStory && (
            <ForecastStoryCard story={forecastStory} baseCurrency={currency} />
          )}

          {/* T28 — Income strip (8 S widgets). */}
          <IncomeStrip
            currency={currency}
            landedMtd={landedMtd}
            weekLanded={weekLanded}
            outstandingTotal={outstandingTotal}
            feesMtd={feesMtd}
            avgDaysToPayment={avgDaysToPayment}
            biggestDebtor={biggestDebtor}
            ytd={ytd}
            trailing30={trailing30}
          />

          {/* T30 — Wallet runway M widget with overdraft tri-state colors. */}
          <WalletRunwayWidget
            holdings={holdings}
            dailyBurnByWallet={new Map(dailyBurnByWallet)}
            currency={currency}
          />

          {/* T26 + T27 — Body + behavior strip. */}
          <div className="space-y-3">
            <PackRhythmWidget read={packRhythm} baseCurrency={currency} />
            <NightSpendsRemark read={lateNight} />
          </div>

          {/* Alerts — only render if there is at least one */}
          {alerts.length > 0 && <Alerts rows={alerts} currency={currency} />}

          {/* Jump-to nav */}
          <JumpTo />
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────── 30-DAY PULSE ──

// Locked palette tokens — acid-lime (positive money in), terracotta (warm
// attention / spend), slate-muted (informational). NO --chart-1, --success,
// --overdue, no gradients — those introduce fifth colors outside the locked
// system.
const LIME_TOKEN = "oklch(0.85 0.18 120)";
const TERRACOTTA_TOKEN = "oklch(0.7 0.13 45)";

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
      <div className="flex items-end justify-between gap-3 px-5 pt-4">
        <div className="flex items-center gap-5 text-[13px]">
          <Legend swatch={LIME_TOKEN} label="Landed" value={landedTotal} currency={currency} />
          <Legend swatch={TERRACOTTA_TOKEN} label="Spent" value={spentTotal} currency={currency} />
        </div>
        <div className="text-right">
          <div className="display-eyebrow text-muted-foreground">30-day net</div>
          <div
            className={cn(
              "mt-1 font-heading text-base font-medium tabular tracking-tight",
              // Acid-lime for positive, terracotta for negative — locked palette
              // (no green --success, no extra color slot).
              net < 0 ? "text-[oklch(0.7_0.13_45)]" : "text-[oklch(0.85_0.18_120)]",
            )}
          >
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
  // Legend values are NOT hero numbers — they sit alongside the sparkline
  // labels. Per the locked rule ("AnimatedNumber wraps hero numbers only"),
  // we keep these as muted small-text rather than display-tabular so they
  // don't compete with the 30-day-net hero on the right.
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span aria-hidden className="inline-block size-1.5 translate-y-[-1px] rounded-full" style={{ background: swatch }} />
      <span className="text-muted-foreground">{label}</span>
      <span className="text-sm tabular-nums text-muted-foreground">
        {formatMoney(value, currency, { compact: true })}
      </span>
    </span>
  );
}

// Two overlaid strokes — no gradient halo (per locked widget system: "DON'T
// add a glow / gradient halo behind the shape"). 1.5px stroke is enough.
function DualSparkline({ landed, spent }: { landed: number[]; spent: number[] }) {
  const length = Math.max(landed.length, spent.length);
  if (length < 2) return <div className="h-12" />;
  // Pad either array to match length (front-pad with zeros for stability).
  const L = padFront(landed, length);
  const S = padFront(spent, length);
  let max = 1;
  for (const v of L) if (v > max) max = v;
  for (const v of S) if (v > max) max = v;
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
      <path d={landedPath} fill="none" stroke={LIME_TOKEN} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <path d={spentPath} fill="none" stroke={TERRACOTTA_TOKEN} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 2" opacity={0.85} />
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
      // Terracotta accent — locked palette's "warm attention" signal.
      className="overflow-hidden rounded-xl border-l-2 border-l-[oklch(0.7_0.13_45)]/70 bg-card ring-1 ring-foreground/10"
    >
      <div className="flex items-center gap-2 border-b border-foreground/10 px-3 py-2">
        {/* The terracotta left border on the section already carries the
            warm-attention tone; an icon would double the signal and AlertCircle
            isn't in the locked vocabulary. Header reads as a text label only. */}
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
  // Locked-vocabulary glyphs: Wallet for negative-wallet, Clock for
  // recurring-due, MessageCircle for ai-questions. Same icons render
  // elsewhere on the dashboard with the same meaning.
  return (
    <span className="grid size-5 shrink-0 place-items-center rounded-md bg-foreground/[0.06]">
      {alertGlyph(kind)}
    </span>
  );
}

function AlertLabel({ row, currency }: { row: AlertRow; currency: CurrencyCode }) {
  if (row.kind === "negative-wallet") {
    // No inline terracotta on the number — the band's left border already
    // carries the warm-attention tone; two layers crosses "one accent inks
    // the active part".
    return (
      <span className="min-w-0 truncate">
        <span className="font-medium">{row.name}</span>{" "}
        <span className="text-muted-foreground">is short</span>{" "}
        <span className="tabular">
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
  // Locked vocabulary mapping for nav chrome — extends the symbol table
  // with semantic glyphs we already use elsewhere:
  //   Spending → ArrowUpRight (outflow / spend glyph, matches Fees S widget)
  //   Payments → ArrowDownLeft (income glyph, matches Landed S widgets)
  //   Clients  → Users (person collection; matches the empty-state)
  //   Projects → Target (plan glyph — projects ship to a target deliverable)
  const items: { label: string; href: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { label: "Spending", href: "/spending", icon: ArrowUpRight },
    { label: "Payments", href: "/payments", icon: ArrowDownLeft },
    { label: "Clients", href: "/clients", icon: Users },
    { label: "Projects", href: "/projects", icon: Target },
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
