"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { ArrowDownRight, ArrowUpRight, Plus, Search } from "lucide-react";
import NumberFlow from "@number-flow/react";
import { PageMonthNav, MonthNavStat, type MonthValue } from "@/components/app/page-month-nav";
import { EmptyState } from "@/components/app/empty-state";
import { SpendHeatmap } from "@/components/spending/spend-heatmap";
import { SpendOverTime } from "@/components/spending/spend-over-time";
import { CategoryTrendSmallMultiples } from "@/components/spending/category-trend-small-multiples";
import { VendorIntelligence } from "@/components/spending/vendor-intelligence";
import { SpendAnomaliesPanel } from "@/components/spending/spend-anomalies-panel";
import { InvestmentVsConsumption } from "@/components/spending/investment-vs-consumption";
import { extractVendorToken, vendorSlug } from "@/lib/spending/vendor-extract";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type {
  CurrencyCode,
  PriceIntelligenceRow,
  Spend,
  SpendCategory,
  SpendCategoryLink,
  SpendItem,
} from "@/lib/supabase/types";
import type { SafeToSpendBreakdown } from "@/lib/safe-to-spend";
import type { SpendingAnomaly } from "@/lib/ai/spending-anomalies";
import { SpendModal, type WalletOpt, type SpendModalDefaults } from "./spend-modal";

const EASE = [0.22, 1, 0.36, 1] as const;

export type SpendRow = {
  id: string;
  spentAt: string;
  amount: number;
  currency: CurrencyCode;
  amountBase: number;
  description: string | null;
  walletId: string;
  walletName: string;
  categoryIds: string[];
  businessRelevant: boolean;
};

type BusinessFilter = "all" | "business" | "personal";
type SpendingTab = "spends" | "trends" | "vendors";

export function SpendingView({
  rows,
  categories,
  wallets,
  currencies,
  rates,
  baseCurrency,
  safeToSpendBaseline,
  recentSpends,
  spendsTrailing6mo,
  spendCategoryLinks,
  spendItems,
  priceIntelCache,
  anomalies,
  initialMonth,
  openNew,
  defaultCategoryId,
  tab = "spends",
}: {
  rows: SpendRow[];
  categories: SpendCategory[];
  wallets: WalletOpt[];
  currencies: string[];
  rates: { code: string; rate_to_base: number }[];
  baseCurrency: CurrencyCode;
  safeToSpendBaseline: SafeToSpendBreakdown;
  recentSpends: Spend[];
  spendsTrailing6mo: Spend[];
  spendCategoryLinks: SpendCategoryLink[];
  spendItems: SpendItem[];
  priceIntelCache?: PriceIntelligenceRow[];
  anomalies: SpendingAnomaly[];
  initialMonth: MonthValue;
  openNew?: boolean;
  defaultCategoryId?: string;
  tab?: SpendingTab;
}) {
  const showSpends = tab === "spends";
  const showTrends = tab === "trends";
  const showVendors = tab === "vendors";
  const router = useRouter();
  const searchParams = useSearchParams();

  const [sheetOpen, setSheetOpen] = useState(openNew ?? false);
  const [sheetDefaults, setSheetDefaults] = useState<SpendModalDefaults | undefined>(
    defaultCategoryId ? { categoryId: defaultCategoryId } : undefined,
  );
  const [month, setMonth] = useState<MonthValue>(initialMonth);
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [walletFilter, setWalletFilter] = useState<string>("");
  const [bizFilter, setBizFilter] = useState<BusinessFilter>("all");
  const [search, setSearch] = useState<string>("");

  useEffect(() => {
    const m = searchParams.get("m");
    if (!m) return;
    const parsed = parseMonthSlug(m);
    if (parsed && (parsed.year !== month.year || parsed.month !== month.month)) {
      setMonth(parsed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const setMonthValue = useCallback(
    (next: MonthValue) => {
      setMonth(next);
      const sp = new URLSearchParams(searchParams.toString());
      sp.set("m", monthSlug(next));
      router.replace(`?${sp.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  // External openers (e.g. SadakaQuickLogButton on /today). One global event,
  // one modal — keeps the form's state machine in a single place.
  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent).detail as SpendModalDefaults | undefined;
      setSheetDefaults(detail);
      setSheetOpen(true);
    }
    window.addEventListener("freelane:open-spend-sheet", onOpen);
    return () => window.removeEventListener("freelane:open-spend-sheet", onOpen);
  }, []);

  function openFresh() {
    setSheetDefaults(undefined);
    setSheetOpen(true);
  }

  const activeCategories = useMemo(
    () => categories.filter((c) => !c.archived).sort((a, b) => a.sort_order - b.sort_order),
    [categories],
  );
  const categoryNameById = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  );

  const monthRange = useMemo(() => monthBoundsOf(month), [month]);
  const prevRange = useMemo(() => monthBoundsOf(stepMonth(month, -1)), [month]);

  const monthRows = useMemo(
    () => rows.filter((r) => withinRange(r.spentAt, monthRange)),
    [rows, monthRange],
  );
  const prevRows = useMemo(
    () => rows.filter((r) => withinRange(r.spentAt, prevRange)),
    [rows, prevRange],
  );

  // Heatmap + over-time charts work directly on raw Spend records, so slice
  // recentSpends to the active month rather than rebuilding from SpendRow.
  const monthSpends = useMemo(
    () =>
      recentSpends.filter((s) => {
        const t = new Date(s.spent_at).getTime();
        return t >= monthRange.start && t < monthRange.end;
      }),
    [recentSpends, monthRange],
  );

  // Wallet chips reflect actually-used wallets in this month.
  const walletChips = useMemo(() => {
    const used = new Set(monthRows.map((r) => r.walletId));
    return wallets.filter((w) => used.has(w.id));
  }, [wallets, monthRows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return monthRows.filter((r) => {
      if (categoryFilter && !r.categoryIds.includes(categoryFilter)) return false;
      if (walletFilter && r.walletId !== walletFilter) return false;
      if (bizFilter === "business" && !r.businessRelevant) return false;
      if (bizFilter === "personal" && r.businessRelevant) return false;
      if (q) {
        const haystack = `${r.description ?? ""} ${r.walletName}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [monthRows, categoryFilter, walletFilter, bizFilter, search]);

  const monthTotal = monthRows.reduce((s, r) => s + r.amountBase, 0);
  const prevTotal = prevRows.reduce((s, r) => s + r.amountBase, 0);
  const deltaPct = prevTotal > 0 ? ((monthTotal - prevTotal) / prevTotal) * 100 : null;
  const visibleTotal = visible.reduce((s, r) => s + r.amountBase, 0);
  const isFiltered =
    !!categoryFilter || !!walletFilter || bizFilter !== "all" || search.trim().length > 0;

  // Avg daily uses elapsed days in the active month — for a past month, full
  // month length; for the current month, days-so-far. Past zero noise out.
  const daysElapsed = elapsedDaysOf(month);
  const avgDaily = daysElapsed > 0 ? monthTotal / daysElapsed : 0;

  // Biggest day — peak daily total within the month, for the stat strip.
  const biggestDay = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const r of monthRows) {
      const key = r.spentAt.slice(0, 10);
      byDay.set(key, (byDay.get(key) ?? 0) + r.amountBase);
    }
    let max = 0;
    for (const v of byDay.values()) if (v > max) max = v;
    return max;
  }, [monthRows]);

  // Business share — drives the 5th stat in the strip.
  const businessTotal = monthRows
    .filter((r) => r.businessRelevant)
    .reduce((s, r) => s + r.amountBase, 0);
  const businessSharePct = monthTotal > 0 ? (businessTotal / monthTotal) * 100 : 0;

  const showRecoveryCaption =
    isCurrentMonth(month) && safeToSpendBaseline.inRecovery;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {(showSpends || showTrends) && (
        <PageMonthNav
          value={month}
          onChange={setMonthValue}
          maxMonth={currentMonthValue()}
          summary={
            <>
              <MonthNavStat
                label="Spent"
                value={
                  <NumberFlow
                    value={Math.round(monthTotal)}
                    format={{
                      style: "currency",
                      currency: baseCurrency,
                      maximumFractionDigits: 0,
                    }}
                    className="font-fraunces tabular text-base leading-none"
                  />
                }
              />
              {deltaPct !== null && (
                <MonthNavStat
                  label="vs prev"
                  tone={deltaPct > 0 ? "warning" : "positive"}
                  value={
                    <span className="inline-flex items-center gap-0.5">
                      {deltaPct > 0 ? (
                        <ArrowUpRight className="h-3 w-3" />
                      ) : (
                        <ArrowDownRight className="h-3 w-3" />
                      )}
                      {Math.abs(deltaPct).toFixed(0)}%
                    </span>
                  }
                />
              )}
            </>
          }
        />
      )}

      {(showSpends || showTrends) && showRecoveryCaption && (
        <div className="mt-4 rounded-[8px] border-l-2 border-[var(--color-warning,theme(colors.orange.400))] bg-foreground/[0.03] py-2 pl-3 pr-3 text-[12px] leading-snug text-muted-foreground">
          Recovery mode — trailing spend ran ahead of income. Daily floor softened{" "}
          {formatMoney(safeToSpendBaseline.recoveryDailyTaxBase, baseCurrency, { compact: true })}
          /day.
        </div>
      )}

      {/* Stat strip — compact horizontal row of mini stats. Rides with the
          Spends and Trends tabs (it summarizes the navigated month). */}
      {(showSpends || showTrends) && (
        <StatStrip
          items={[
            { label: "Total", value: formatMoney(monthTotal, baseCurrency, { compact: true }) },
            deltaPct === null
              ? { label: "vs prev", value: "—" }
              : {
                  label: "vs prev",
                  value: `${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(0)}%`,
                  tone: deltaPct > 0 ? "warning" : "positive",
                },
            { label: "Avg/day", value: formatMoney(avgDaily, baseCurrency, { compact: true }) },
            {
              label: "Biggest day",
              value: formatMoney(biggestDay, baseCurrency, { compact: true }),
            },
            { label: "Business", value: `${businessSharePct.toFixed(0)}%` },
          ]}
        />
      )}

      {/* Daily rhythm — Spends subtab keeps the heatmap above the filters so
          the calendar-shape of the month reads before you start drilling. */}
      {showSpends && (
        <section className="mt-5">
          <Panel
            eyebrow={monthHeatmapLabel(month)}
            subtitle="Daily rhythm — darker means more spent."
          >
            <SpendHeatmap
              spends={monthSpends}
              year={month.year}
              month={month.month - 1}
              baseCurrency={baseCurrency}
            />
          </Panel>
        </section>
      )}

      {/* Two-column rhythm: charts on the left, intelligence on the right.
          Trends subtab only — full-width analytical surface. */}
      {showTrends && (
      <section className="mt-5 grid gap-4 lg:grid-cols-5">
        {/* LEFT (~60%): trend + heatmap */}
        <div className="space-y-4 lg:col-span-3">
          <Panel eyebrow="Last 6 months" subtitle="Spend over time, base currency.">
            <SpendOverTime
              spends={spendsTrailing6mo}
              now={new Date()}
              baseCurrency={baseCurrency}
              height={160}
            />
          </Panel>
          <Panel
            eyebrow={monthHeatmapLabel(month)}
            subtitle="Daily rhythm — darker means more spent."
          >
            <SpendHeatmap
              spends={monthSpends}
              year={month.year}
              month={month.month - 1}
              baseCurrency={baseCurrency}
            />
          </Panel>
        </div>

        {/* RIGHT (~40%): categories small-multiples, vendors, anomalies */}
        <div className="space-y-4 lg:col-span-2">
          {anomalies.length > 0 && (
            <Panel eyebrow="What's drifting" subtitle="Numbers that broke their rhythm.">
              <div className="px-3 pb-3">
                <SpendAnomaliesPanel anomalies={anomalies} />
              </div>
            </Panel>
          )}
          <Panel eyebrow="Categories" subtitle="Trailing 6 months, top by spend.">
            <CategoryTrendSmallMultiples
              spends={spendsTrailing6mo}
              categoryLinks={spendCategoryLinks}
              categories={categories}
              baseCurrency={baseCurrency}
              now={new Date()}
              topN={6}
            />
          </Panel>
          <InvestmentVsConsumption
            spends={monthSpends}
            links={spendCategoryLinks}
            categories={categories}
            baseCurrency={baseCurrency}
            windowLabel={monthHeatmapLabel(month)}
          />
          <Panel eyebrow="Top vendors" subtitle="Lifetime pattern, click for detail.">
            <VendorIntelligence spends={recentSpends} baseCurrency={baseCurrency} />
          </Panel>
        </div>
      </section>
      )}

      {/* Vendors subtab placeholder — surface ships with the Vendors
          workflow. Holds the structural shell so the route resolves and
          SubtabBar stays consistent across the three tabs. */}
      {showVendors && (
        <section className="mt-5 space-y-4">
          <div className="rounded-[14px] border border-foreground/10 bg-card/40 p-5">
            <div className="display-eyebrow text-muted-foreground">Vendors</div>
            <p className="mt-2 text-[13px] text-foreground/85">
              Vendor management surface arrives next.
            </p>
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              Lifetime totals, spend rhythm, and per-vendor memory will live
              here once the Vendors workflow ships.
            </p>
          </div>
          <Panel eyebrow="Top vendors" subtitle="Lifetime pattern, click for detail.">
            <VendorIntelligence spends={recentSpends} baseCurrency={baseCurrency} />
          </Panel>
        </section>
      )}

      {/* Filters — compact chip rows + search. Spends subtab. */}
      {showSpends && (
      <section className="mt-6">
        <div className="flex flex-col gap-2">
          <ChipRow>
            <Chip active={bizFilter === "all"} onClick={() => setBizFilter("all")}>
              All
            </Chip>
            <Chip
              active={bizFilter === "business"}
              onClick={() => setBizFilter("business")}
            >
              Business
            </Chip>
            <Chip
              active={bizFilter === "personal"}
              onClick={() => setBizFilter("personal")}
            >
              Personal
            </Chip>
            <span className="mx-1 h-5 w-px self-center bg-foreground/10" />
            <SearchInput value={search} onChange={setSearch} />
          </ChipRow>

          {activeCategories.length > 0 && (
            <ChipRow>
              <Chip active={categoryFilter === ""} onClick={() => setCategoryFilter("")}>
                All categories
              </Chip>
              {activeCategories.map((c) => (
                <Chip
                  key={c.id}
                  active={categoryFilter === c.id}
                  onClick={() =>
                    setCategoryFilter(categoryFilter === c.id ? "" : c.id)
                  }
                >
                  {c.name}
                </Chip>
              ))}
            </ChipRow>
          )}

          {walletChips.length > 1 && (
            <ChipRow>
              <Chip active={walletFilter === ""} onClick={() => setWalletFilter("")}>
                All wallets
              </Chip>
              {walletChips.map((w) => (
                <Chip
                  key={w.id}
                  active={walletFilter === w.id}
                  onClick={() => setWalletFilter(walletFilter === w.id ? "" : w.id)}
                >
                  {w.name}
                </Chip>
              ))}
            </ChipRow>
          )}
        </div>

        {isFiltered && visible.length > 0 && (
          <div className="mt-3 flex items-baseline justify-between text-[12px] text-muted-foreground">
            <span>
              {visible.length} {visible.length === 1 ? "spend" : "spends"} shown
            </span>
            <span className="tabular text-foreground">
              {formatMoney(visibleTotal, baseCurrency, { compact: true })}
            </span>
          </div>
        )}
      </section>
      )}

      {/* Dense list — Spends subtab only. */}
      {showSpends && (
      <section className="mt-4">
        {rows.length === 0 ? (
          <EmptyState
            title="Nothing logged yet."
            description="The first spend you log starts a calmer rhythm — the rest follows."
            action={
              <button
                type="button"
                onClick={openFresh}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-md px-3.5 text-[13px] font-medium tracking-tight",
                  "bg-[var(--brand)] text-[var(--brand-foreground)]",
                  "transition-[transform,filter] duration-300 ease-out",
                  "hover:brightness-[0.97] active:translate-y-px",
                )}
              >
                <Plus className="h-3.5 w-3.5" /> Log a spend
              </button>
            }
          />
        ) : monthRows.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-muted-foreground">
            Nothing spent this month.
          </p>
        ) : visible.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-muted-foreground">
            Nothing matches these filters.
          </p>
        ) : (
          <ul className="border-t border-foreground/10">
            {visible.map((row, i) => (
              <SpendItemRow
                key={row.id}
                row={row}
                baseCurrency={baseCurrency}
                categoryNameById={categoryNameById}
                index={i}
              />
            ))}
          </ul>
        )}
      </section>
      )}

      {/* Floating CTA + modal — the spend log surface. Keep mounted on the
          Spends subtab only so the modal doesn't compete with the Trends
          analytical reading mode. */}
      {showSpends && <FloatingLogButton onClick={openFresh} />}

      <SpendModal
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        wallets={wallets}
        categories={categories}
        currencies={currencies}
        baseCurrency={baseCurrency}
        rates={rates}
        recentSpends={recentSpends}
        spendCategoryLinks={spendCategoryLinks}
        spendItems={spendItems}
        priceIntelCache={priceIntelCache}
        safeToSpendBaseline={safeToSpendBaseline}
        defaults={sheetDefaults}
      />
    </div>
  );
}

function Panel({
  eyebrow,
  subtitle,
  children,
}: {
  eyebrow: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[14px] border border-foreground/10 bg-card/40">
      <div className="flex items-baseline justify-between gap-3 border-b border-foreground/10 px-4 py-3">
        <span className="display-eyebrow text-muted-foreground">{eyebrow}</span>
        {subtitle && (
          <span className="text-[12px] text-muted-foreground/80 truncate">
            {subtitle}
          </span>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

interface StatItem {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "warning";
}

function StatStrip({ items }: { items: StatItem[] }) {
  return (
    <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-foreground/10 bg-foreground/8 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((item, i) => (
        <motion.div
          key={`${item.label}-${i}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: i * 0.04, ease: EASE }}
          className="flex flex-col gap-1.5 bg-card/60 px-4 py-4"
        >
          <span className="text-[12px] uppercase tracking-[0.16em] text-muted-foreground/80">
            {item.label}
          </span>
          <span
            className={cn(
              "font-fraunces tabular text-[28px] leading-none",
              item.tone === "positive" &&
                "text-[var(--color-positive,theme(colors.lime.400))]",
              item.tone === "warning" &&
                "text-[var(--color-warning,theme(colors.orange.400))]",
              !item.tone && "text-foreground",
            )}
          >
            {item.value}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="inline-flex h-7 items-center gap-1.5 rounded-full border border-foreground/15 bg-card/40 px-2.5 text-[12px] text-foreground/80 focus-within:border-foreground/35">
      <Search className="h-3 w-3 text-muted-foreground" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search descriptions"
        className="w-36 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/60 sm:w-48"
      />
    </label>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1.5">{children}</div>;
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[12px] font-medium",
        "transition-colors duration-200 ease-out",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-foreground/15 text-foreground/70 hover:bg-foreground/[0.05] hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function SpendItemRow({
  row,
  baseCurrency,
  categoryNameById,
  index,
}: {
  row: SpendRow;
  baseCurrency: CurrencyCode;
  categoryNameById: Map<string, string>;
  index: number;
}) {
  const tags = row.categoryIds
    .map((id) => ({ id, name: categoryNameById.get(id) }))
    .filter((t): t is { id: string; name: string } => !!t.name);

  // Vendor link — only if the description resolves to a known/guessed vendor.
  const vendorMatch = row.description
    ? extractVendorToken(row.description)
    : { vendor: null, confidence: null };
  const vendorHref = vendorMatch.vendor
    ? `/spending/vendor/${vendorSlug(vendorMatch.vendor)}`
    : null;

  return (
    <motion.li
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.28, delay: Math.min(index, 8) * 0.02, ease: EASE }}
      className="flex items-center gap-3 border-b border-foreground/10 py-2.5"
    >
      <div className="w-12 shrink-0 text-[11px] tabular text-muted-foreground">
        {formatDate(row.spentAt)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {row.description?.trim() ? (
            vendorHref ? (
              <Link
                href={vendorHref}
                className="truncate text-[13px] text-foreground transition-colors hover:text-[var(--brand)]"
              >
                {row.description}
              </Link>
            ) : (
              <span className="truncate text-[13px] text-foreground">
                {row.description}
              </span>
            )
          ) : (
            <span className="truncate text-[13px] text-muted-foreground/60">—</span>
          )}
          {row.businessRelevant && (
            <span
              aria-label="Business-relevant"
              title="Business-relevant"
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]"
            />
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="rounded-sm bg-foreground/[0.05] px-1.5 py-px text-foreground/80">
            {row.walletName}
          </span>
          {tags.length > 0 && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="inline-flex flex-wrap gap-x-1 gap-y-0.5">
                {tags.map((t, i) => (
                  <span key={t.id}>
                    <Link
                      href={`/spending/category/${t.id}`}
                      className="text-muted-foreground/85 transition-colors hover:text-foreground"
                    >
                      {t.name}
                    </Link>
                    {i < tags.length - 1 && (
                      <span className="text-muted-foreground/40">,</span>
                    )}
                  </span>
                ))}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="text-[13px] tabular text-foreground">
          {formatMoney(row.amountBase, baseCurrency)}
        </div>
        {row.currency !== baseCurrency && (
          <div className="mt-0.5 text-[10px] tabular text-muted-foreground/70">
            {formatMoney(row.amount, row.currency, { compact: true })}
          </div>
        )}
      </div>
    </motion.li>
  );
}

function FloatingLogButton({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.35, ease: EASE }}
      className={cn(
        "fixed right-5 bottom-5 z-30 inline-flex h-11 items-center gap-2 rounded-full px-4 text-[13px] font-medium tracking-tight",
        "bg-[var(--brand)] text-[var(--brand-foreground)]",
        "shadow-[0_14px_38px_-18px_oklch(from_var(--foreground)_l_c_h_/_0.55)]",
        "transition-[transform,filter] duration-300 ease-out",
        "hover:brightness-[0.97] active:translate-y-px",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30",
        "sm:right-6 sm:bottom-6",
      )}
      aria-label="Log spend"
    >
      <Plus className="h-4 w-4" />
      Log spend
    </motion.button>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function monthBoundsOf({ year, month }: MonthValue): { start: number; end: number } {
  const start = new Date(year, month - 1, 1).getTime();
  const end = new Date(year, month, 1).getTime();
  return { start, end };
}

function withinRange(iso: string, range: { start: number; end: number }): boolean {
  const t = new Date(iso).getTime();
  return t >= range.start && t < range.end;
}

function stepMonth({ year, month }: MonthValue, delta: number): MonthValue {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

function currentMonthValue(): MonthValue {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function isCurrentMonth(m: MonthValue): boolean {
  const cur = currentMonthValue();
  return cur.year === m.year && cur.month === m.month;
}

function elapsedDaysOf(m: MonthValue): number {
  const now = new Date();
  const monthStart = new Date(m.year, m.month - 1, 1);
  const nextMonth = new Date(m.year, m.month, 1);
  if (now < monthStart) return 0;
  if (now >= nextMonth) {
    return Math.round((nextMonth.getTime() - monthStart.getTime()) / 86_400_000);
  }
  return now.getDate();
}

function monthHeatmapLabel(m: MonthValue): string {
  return new Date(m.year, m.month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
  });
}

function monthSlug({ year, month }: MonthValue): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function parseMonthSlug(slug: string): MonthValue | null {
  const m = /^(\d{4})-(\d{2})$/.exec(slug);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!year || month < 1 || month > 12) return null;
  return { year, month };
}
