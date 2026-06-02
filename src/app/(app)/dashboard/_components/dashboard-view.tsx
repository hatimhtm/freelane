"use client";

import Link from "next/link";
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
import { NegativeWalletAlarm } from "@/components/app/negative-wallet-alarm";
import { NightSpendsRemark } from "@/components/widgets/dashboard/night-spends-remark";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { CalmWeatherState, CurrencyCode } from "@/lib/supabase/types";
import type { HoldingBalanceRow } from "@/lib/payment-chain";
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

type DashboardTab = "money" | "commitments" | "state" | "body";

// DashboardView is the cross-tab chrome: header, EmptyState path, calm
// weather banner, NegativeWalletAlarm (Money only), the Alerts band on
// Money, JumpTo nav on Money + Commitments, and the NightSpendsRemark
// strip on Body. Every other widget moved into its own subtab page.
type DashboardViewProps = {
  firstName: string | null;
  currency: CurrencyCode;
  hasClients: boolean;
  year: number;
  alerts: AlertRow[];
  calmWeather: CalmWeatherState | null;
  holdings?: HoldingBalanceRow[];
  lateNight?: LateNightClusterRead | null;
  tab?: DashboardTab;
  // Legacy slots kept for backwards-compat with subtab pages that still
  // forward {...props}. The view doesn't render any of these directly
  // anymore — the brain reads them, the Money page renders the new tiles.
  landedMtd?: number;
  spentMtd?: number;
  feesMtd?: number;
  outstandingTotal?: number;
  walletTotal?: number;
  safeToday?: number;
  landedSeries?: number[];
  spentSeries?: number[];
  atlas?: unknown;
  forecastStory?: unknown;
  dailyBurnByWallet?: Array<[string, number]>;
  weekLanded?: number;
  avgDaysToPayment?: number | null;
  biggestDebtor?: { name: string; total: number } | null;
  ytd?: number;
  trailing30?: number;
  packRhythm?: unknown;
  // Calm degradation banner — fires when the ledger reader has unresolved
  // write-failures or threw on this render. We render a single muted strip
  // above the calm-weather banner so the user knows numbers may have
  // drifted instead of trusting silent fallback math.
  dataDegraded?: boolean;
};

export function DashboardView({
  firstName,
  currency,
  hasClients,
  year,
  alerts,
  calmWeather,
  holdings = [],
  lateNight = null,
  tab = "money",
  dataDegraded = false,
}: DashboardViewProps) {
  // Per-subtab section gating. The view stays a single component (shared
  // header, EmptyState path, calm-weather banner, JumpTo) so cross-tab
  // chrome can't drift; only the per-tab sections paint.
  const showMoney = tab === "money";
  const showCommitments = tab === "commitments";
  // showState intentionally NOT used — the State page owns its own widgets
  // and renders no fallback DashboardView slot.
  const showBody = tab === "body";
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
          {dataDegraded && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-700 dark:text-amber-200"
            >
              Dashboard data degraded — some ledger writes did not settle.
              Numbers shown may lag the source tables until the next
              reconciliation pass.
            </div>
          )}
          {/* Calm Weather Mode — shared chrome across all subtabs (mirrors
              Today's calm band, never tab-dependent). */}
          {calmWeather && (
            <CalmWeatherBanner state={calmWeather} variant="dashboard" />
          )}
          {/* Negative wallet alarm rides with the Money tab — it's a
              wallet-state surface, not state-of-self. */}
          {showMoney && <NegativeWalletAlarm holdings={holdings} />}

          {/* Money tab — Phase 1.5 page owns the headline grid (TotalWallets,
              ThirtyDayNet, Forecast, WalletStack, SpendTrend, PackRhythm).
              The legacy MWidget hero + CashflowAtlas + PulseStrip + Forecast
              Storyteller + IncomeStrip + WalletRunway were all removed
              from this view to stop the duplicate-forecast / duplicate-net
              chrome the brief flagged. The hero MWidget is referenced here
              only via the variables that survived: safeToday + landedMtd
              etc. are no longer wired on Money. */}
          {showMoney && (
            <>
              {alerts.length > 0 && <Alerts rows={alerts} currency={currency} />}
              <JumpTo />
            </>
          )}

          {showCommitments && (
            <>
              {/* Commitments page owns the 4 S widgets in its brief.
                  DashboardView only fills in cross-tab chrome (jump-to nav)
                  so we don't re-paint IncomeStrip / alerts here. */}
              <JumpTo />
            </>
          )}

          {/* State subtab no longer mounts DashboardView at all — the State
              page renders PeriodWidget + RecoveryWidget directly. */}

          {showBody && (
            <>
              {/* T27 — late-night cluster carries the body-side spending
                  signal. PackRhythmWidget moved to /dashboard/money per
                  brief — it's a money widget. */}
              <div className="space-y-3">
                <NightSpendsRemark read={lateNight} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
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
