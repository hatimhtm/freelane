"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CalendarRange, Hourglass, Receipt, Sparkles, UserX } from "lucide-react";
import { motion } from "motion/react";
import { Card } from "@/components/ui/card";
import { MetricTile } from "@/components/stats/stat";
import { AiPanel } from "@/components/app/ai-panel";
import { MetricTrigger } from "@/components/app/metric-sheet";
import { TodaysFocus } from "@/components/app/todays-focus";
import { BlockedMoneyList, type BlockedRow } from "@/components/app/blocked-money-list";
import { MorningBriefHero } from "@/components/app/morning-brief-hero";
import { NegativeWalletAlarm } from "@/components/app/negative-wallet-alarm";
import { IncomeSadakaSuggestion } from "@/components/app/income-sadaka-suggestion";
import { AiQuestionsCard } from "@/components/app/ai-questions-card";
import { WalletRunwayCard } from "@/components/app/wallet-runway-card";
import { RecurringWindowWatch } from "@/components/app/recurring-window-watch";
import { SadakaQuickLogButton } from "@/components/app/sadaka-quick-log-button";
import { CalmWeatherBanner } from "@/components/app/calm-weather-banner";
import { TightModeCoach } from "@/components/app/tight-mode-coach";
import { ForecastStoryCard } from "@/components/app/forecast-story-card";
import { Reveal } from "@/components/motion/reveal";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type {
  AiQuestion,
  CalmWeatherState,
  CurrencyCode,
  ExchangeRate,
  RecurringSpend,
  RecurringSpendSkip,
  Spend,
  SpendCategory,
  SpendCategoryLink,
  SpendItem,
} from "@/lib/supabase/types";
import type { MoneyInsight } from "@/lib/ai/actions";
import type { SafeToSpendOverlay } from "@/lib/ai/safe-to-spend-ai";
import type { TightModeRead } from "@/lib/ai/tight-mode-coach";
import type { ForecastStory } from "@/lib/ai/forecast-storyteller";
import type { SafeToSpendBreakdown } from "@/lib/safe-to-spend";
import type { HoldingBalanceRow } from "@/lib/payment-chain";
import {
  SpendModal,
  type SpendModalDefaults,
  type WalletOpt,
} from "@/app/(app)/spending/_components/spend-modal";

const EASE = [0.16, 1, 0.3, 1] as const;

type Metrics = {
  mtd: number; lastMonth: number; momDelta: number | null;
  wtd: number; lastWeek: number; wowDelta: number | null;
  ytd: number; feesMtd: number;
};

function greetingFor(hour: number): string {
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function TodayView({
  firstName,
  currency,
  hasClients,
  metrics,
  series,
  pendingTotal,
  pendingCount,
  biggestDebtor,
  avgDaysToPayment,
  blocked,
  topClients,
  recent,
  situation,
  year,
  aiEnabled,
  focusInsights,
  focusGeneratedAt,
  overlay,
  holdings,
  dailyBurnByWalletEntries,
  sadakaSuggestion,
  triggeringPayment,
  sadakaCategoryId,
  openAiQuestions,
  recurring,
  recurringSkips,
  rates,
  spendCategories,
  spendCategoryLinks,
  spendItems,
  spends,
  sheetWallets,
  currencies,
  safeToSpendBaseline,
  calmWeather,
  tightMode,
  forecastStory,
}: {
  firstName: string | null;
  currency: CurrencyCode;
  hasClients: boolean;
  metrics: Metrics;
  series: number[];
  pendingTotal: number;
  pendingCount: number;
  biggestDebtor: { name: string; total: number } | null;
  avgDaysToPayment: number | null;
  blocked: BlockedRow[];
  topClients: { name: string; value: number }[];
  recent: { id: string; net: number; paidAt: string; projectTitle: string; clientName: string }[];
  situation: string;
  year: number;
  aiEnabled: boolean;
  focusInsights: MoneyInsight[];
  focusGeneratedAt: string | null;
  overlay: SafeToSpendOverlay | null;
  holdings: HoldingBalanceRow[];
  dailyBurnByWalletEntries: Array<[string, number]>;
  sadakaSuggestion: { suggestedBase: number; percent: number; reason: string } | null;
  triggeringPayment: { client: string; net: number; paid_at: string } | null;
  sadakaCategoryId: string | null;
  openAiQuestions: AiQuestion[];
  recurring: RecurringSpend[];
  recurringSkips: RecurringSpendSkip[];
  rates: ExchangeRate[];
  spendCategories: SpendCategory[];
  spendCategoryLinks: SpendCategoryLink[];
  spendItems: SpendItem[];
  spends: Spend[];
  sheetWallets: WalletOpt[];
  currencies: string[];
  safeToSpendBaseline: SafeToSpendBreakdown;
  calmWeather: CalmWeatherState | null;
  tightMode: TightModeRead | null;
  forecastStory: ForecastStory | null;
}) {
  const [greeting, setGreeting] = useState("Welcome back");
  useEffect(() => {
    setGreeting(greetingFor(new Date().getHours()));
  }, []);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetDefaults, setSheetDefaults] = useState<SpendModalDefaults | undefined>(undefined);

  // Mirrors spending-view: one global event, one sheet — keeps the form's
  // state machine in a single place across screens.
  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent).detail as SpendModalDefaults | undefined;
      setSheetDefaults(detail);
      setSheetOpen(true);
    }
    window.addEventListener("freelane:open-spend-sheet", onOpen);
    return () => window.removeEventListener("freelane:open-spend-sheet", onOpen);
  }, []);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const dailyBurnByWallet = useMemo(
    () => new Map(dailyBurnByWalletEntries),
    [dailyBurnByWalletEntries],
  );

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-5 lg:px-8 lg:py-6">
      {/* Greeting + date */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
      >
        <h1 className="display-headline text-2xl md:text-3xl">
          {greeting}{firstName ? `, ${firstName}.` : "."}
        </h1>
        <span className="text-xs text-muted-foreground tabular">{today}</span>
      </motion.div>

      {/* Phase 1.5 + Tier 1 stack — densified, small-window optimized. */}
      <div className="mt-5 space-y-4">
        {/* Calm Weather Mode — the one honest line under everything. */}
        {calmWeather && (
          <CalmWeatherBanner state={calmWeather} variant="today" />
        )}

        {/* Tight Mode Coach — only renders during storm/gust bands. */}
        {tightMode && tightMode.active && (
          <TightModeCoach read={tightMode} baseCurrency={currency} />
        )}

        {/* Alarm only when something is genuinely wrong. */}
        {holdings.some((h) => h.balance < 0) && (
          <NegativeWalletAlarm holdings={holdings} />
        )}

        {/* Main hero — Safe-to-spend with Fraunces numeric. */}
        <MorningBriefHero overlay={overlay} />

        {/* Forecast Storyteller — next 30 days in Hatim's voice. */}
        {forecastStory && (
          <ForecastStoryCard story={forecastStory} baseCurrency={currency} />
        )}

        {/* Open AI questions — letter-like surface, only when there are any
            OR the user can ask for a sweep. */}
        {aiEnabled && (
          <Reveal delay={0.06}>
            <AiQuestionsCard questions={openAiQuestions} />
          </Reveal>
        )}

        {/* Just-landed nudge. Self-dismissing. */}
        {sadakaSuggestion && triggeringPayment && (
          <Reveal delay={0.04}>
            <IncomeSadakaSuggestion
              suggestion={sadakaSuggestion}
              triggeringPayment={triggeringPayment}
              sadakaCategoryId={sadakaCategoryId}
            />
          </Reveal>
        )}

        {/* Wallet runway. */}
        <section>
          <SectionHead title="Wallet runway" hint="Balance ÷ trailing 30d burn" />
          <WalletRunwayCard
            holdings={holdings}
            dailyBurnByWallet={dailyBurnByWallet}
            baseCurrency={currency}
          />
        </section>

        {/* Recurring window — self-hides when nothing is in the next 5d. */}
        <section>
          <SectionHead title="Recurring this week" hint="Next 5 days" />
          <RecurringWindowWatch
            recurring={recurring}
            skips={recurringSkips}
            holdings={holdings}
            rates={rates}
          />
        </section>

        {/* Existing "today's focus" content — preserved verbatim. */}
        {aiEnabled && (
          <Reveal delay={0.1}>
            <TodaysFocus
              initialInsights={focusInsights}
              initialGeneratedAt={focusGeneratedAt}
              enabled={aiEnabled}
            />
          </Reveal>
        )}

        {/* Outstanding situation strip — preserves the "what's the morning
            picture?" framing without competing with the new hero. */}
        <section className="grid items-end gap-4 lg:grid-cols-[1.6fr_1fr]">
          <p className="max-w-prose text-sm leading-relaxed text-foreground/75">
            {situation}
          </p>
          <Reveal delay={0.14}>
            <MetricTrigger metricKey="outstanding" className="lift rounded-xl">
              <Card className="border-border/70 p-4">
                <div className="display-eyebrow flex items-center gap-2 text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-[var(--overdue)] animate-breathe" />
                  Outstanding
                </div>
                <div className="display-numeric mt-2 text-3xl tabular">
                  {formatMoney(pendingTotal, currency, { compact: true })}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Across {pendingCount} open {pendingCount === 1 ? "project" : "projects"}, valued
                  at today&apos;s rates — moves with FX until paid.
                </p>
                <span className="mt-2.5 inline-flex items-center gap-1 text-xs font-medium text-foreground">
                  View outstanding <ArrowUpRight className="size-3" />
                </span>
              </Card>
            </MetricTrigger>
          </Reveal>
        </section>

        {/* BIG Ask-your-money centerpiece — preserved, tighter padding. */}
        {aiEnabled && (
          <Reveal delay={0.18}>
            <div className="relative overflow-hidden rounded-xl border border-foreground/15 bg-gradient-to-b from-muted/40 to-card p-1.5">
              <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-[var(--brand)]/10 blur-3xl" />
              <div className="mb-2 flex items-center gap-2 px-3 pt-2">
                <span className="grid size-6 place-items-center rounded-full bg-foreground text-background">
                  <Sparkles className="size-3" />
                </span>
                <div>
                  <div className="display-eyebrow text-muted-foreground">Your money, on demand</div>
                  <div className="text-sm font-medium">Ask anything, get insights</div>
                </div>
              </div>
              <AiPanel enabled={aiEnabled} />
            </div>
          </Reveal>
        )}

        {/* Richer metric grid — preserved. */}
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <MetricTrigger metricKey="landed" className="h-full">
            <MetricTile
              label="Landed this month"
              value={metrics.mtd}
              currency={currency}
              delta={metrics.momDelta}
              hint="MoM"
              icon={CalendarRange}
              delay={0.02}
            />
          </MetricTrigger>
          <MetricTrigger metricKey="landed" className="h-full">
            <MetricTile
              label="This week"
              value={metrics.wtd}
              currency={currency}
              delta={metrics.wowDelta}
              hint="landed · WoW"
              icon={CalendarRange}
              delay={0.05}
            />
          </MetricTrigger>
          <MetricTrigger metricKey="outstanding" className="h-full">
            <MetricTile
              label="Outstanding"
              value={pendingTotal}
              currency={currency}
              hint={`${pendingCount} open ${pendingCount === 1 ? "project" : "projects"}`}
              icon={Hourglass}
              accent
              delay={0.08}
            />
          </MetricTrigger>
          <MetricTrigger metricKey="fees" className="h-full">
            <MetricTile
              label="Fees this month"
              value={metrics.feesMtd}
              currency={currency}
              hint="rails + FX markup"
              icon={Receipt}
              delay={0.11}
            />
          </MetricTrigger>
          <MetricTrigger metricKey="avg-days" className="h-full">
            <MetricTile
              label="Avg days to payment"
              text={avgDaysToPayment !== null ? `${avgDaysToPayment.toFixed(1)} days` : "—"}
              hint={avgDaysToPayment !== null ? "quote → first payment" : "no paid projects yet"}
              icon={Hourglass}
              delay={0.14}
            />
          </MetricTrigger>
          <MetricTrigger metricKey="debtor" className="h-full">
            <MetricTile
              label="Biggest debtor"
              text={biggestDebtor?.name ?? "—"}
              hint={biggestDebtor ? `${formatMoney(biggestDebtor.total, currency, { compact: true })} outstanding` : "nobody owes you"}
              icon={UserX}
              delay={0.17}
            />
          </MetricTrigger>
          <MetricTrigger metricKey="landed" className="h-full">
            <MetricTile
              label={`Year to date`}
              value={metrics.ytd}
              currency={currency}
              hint={`${year} so far`}
              icon={CalendarRange}
              delay={0.2}
            />
          </MetricTrigger>
          {/* The 30d income sparkline still tells the rhythm story — kept here
              as a compact tile rather than the screen's hero. */}
          <MetricTrigger metricKey="landed" className="h-full sm:col-span-2 lg:col-span-1">
            <MetricTile
              label="Trailing 30 days"
              value={series.reduce((a, b) => a + b, 0)}
              currency={currency}
              hint="income rhythm"
              icon={CalendarRange}
              delay={0.23}
            />
          </MetricTrigger>
        </section>

        {/* What needs you + recent payments */}
        <section className="grid gap-4 lg:grid-cols-2">
          <div>
            <SectionHead title="What needs you" hint="Top open balances, ranked" href="/projects" cta="See all" />
            <BlockedMoneyList rows={blocked} baseCurrency={currency} limit={3} />
          </div>
          <div>
            <SectionHead title="Recent payments" hint={`Last ${recent.length} landed`} href="/payments" cta="Payments" />
            <Card className="overflow-hidden p-0">
              {recent.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  {hasClients ? "No payments logged yet." : "Add a client to get started."}
                </div>
              ) : (
                <ul>
                  {recent.map((p, i) => (
                    <motion.li
                      key={p.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35, delay: i * 0.04, ease: EASE }}
                      className={cn(
                        "flex items-center justify-between px-4 py-2.5",
                        i < recent.length - 1 && "border-b border-border/50",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{p.projectTitle}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {p.clientName} · {new Date(p.paidAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 text-sm font-semibold tabular">
                        <ArrowUpRight className="h-3.5 w-3.5 text-[var(--success)]" />
                        {formatMoney(p.net, currency)}
                      </div>
                    </motion.li>
                  ))}
                </ul>
              )}
            </Card>

            {topClients.length > 0 && (
              <div className="mt-4">
                <SectionHead title="Top clients" hint={`By landed ${currency}`} />
                <MetricTrigger metricKey="debtor" className="lift rounded-xl">
                  <Card className="p-4">
                    <TopClients data={topClients} currency={currency} />
                  </Card>
                </MetricTrigger>
              </div>
            )}
          </div>
        </section>

        {/* Quick actions — single thin row at the bottom, no card. */}
        {sadakaCategoryId && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <SadakaQuickLogButton sadakaCategoryId={sadakaCategoryId} />
          </div>
        )}
      </div>

      <SpendModal
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        wallets={sheetWallets}
        categories={spendCategories}
        currencies={currencies}
        baseCurrency={currency}
        rates={rates.map((r) => ({ code: r.code, rate_to_base: Number(r.rate_to_base) }))}
        recentSpends={spends}
        spendCategoryLinks={spendCategoryLinks}
        spendItems={spendItems}
        safeToSpendBaseline={safeToSpendBaseline}
        defaults={sheetDefaults}
      />
    </div>
  );
}

function TopClients({ data, currency }: { data: { name: string; value: number }[]; currency: CurrencyCode }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ol className="space-y-2.5">
      {data.map((c, i) => (
        <li key={c.name}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="flex items-center gap-2">
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted font-mono text-[10px] text-muted-foreground">{i + 1}</span>
              <span className="truncate font-medium">{c.name}</span>
            </span>
            <span className="shrink-0 tabular text-muted-foreground">{formatMoney(c.value, currency, { compact: true })}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(c.value / max) * 100}%` }}
              transition={{ duration: 0.8, delay: 0.3 + i * 0.08, ease: EASE }}
              className="h-full rounded-full bg-[var(--chart-1)]"
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

function SectionHead({ title, hint, href, cta }: { title: string; hint: string; href?: string; cta?: string }) {
  return (
    <div className="mb-2 flex items-end justify-between">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      {href && cta && (
        <Link href={href} className="text-xs font-medium text-muted-foreground hover:text-foreground">
          {cta} →
        </Link>
      )}
    </div>
  );
}
