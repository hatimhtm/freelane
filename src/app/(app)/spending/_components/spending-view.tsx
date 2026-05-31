"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { ArrowDownRight, ArrowUpRight, Plus } from "lucide-react";
import NumberFlow from "@number-flow/react";
import { PageMonthNav, MonthNavStat, type MonthValue } from "@/components/app/page-month-nav";
import { EmptyState } from "@/components/app/empty-state";
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

export function SpendingView({
  rows,
  categories,
  wallets,
  currencies,
  rates,
  baseCurrency,
  safeToSpendBaseline,
  recentSpends,
  spendCategoryLinks,
  spendItems,
  priceIntelCache,
  initialMonth,
  openNew,
  defaultCategoryId,
}: {
  rows: SpendRow[];
  categories: SpendCategory[];
  wallets: WalletOpt[];
  currencies: string[];
  rates: { code: string; rate_to_base: number }[];
  baseCurrency: CurrencyCode;
  safeToSpendBaseline: SafeToSpendBreakdown;
  recentSpends: Spend[];
  spendCategoryLinks: SpendCategoryLink[];
  spendItems: SpendItem[];
  priceIntelCache?: PriceIntelligenceRow[];
  initialMonth: MonthValue;
  openNew?: boolean;
  defaultCategoryId?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [sheetOpen, setSheetOpen] = useState(openNew ?? false);
  const [sheetDefaults, setSheetDefaults] = useState<SpendModalDefaults | undefined>(
    defaultCategoryId ? { categoryId: defaultCategoryId } : undefined,
  );
  const [month, setMonth] = useState<MonthValue>(initialMonth);
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [walletFilter, setWalletFilter] = useState<string>("");

  // Hydrate month from URL so back/forward and shared links survive.
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

  // Wallet chips reflect actually-used wallets in this month.
  const walletChips = useMemo(() => {
    const used = new Set(monthRows.map((r) => r.walletId));
    return wallets.filter((w) => used.has(w.id));
  }, [wallets, monthRows]);

  const visible = useMemo(() => {
    return monthRows.filter((r) => {
      if (categoryFilter && !r.categoryIds.includes(categoryFilter)) return false;
      if (walletFilter && r.walletId !== walletFilter) return false;
      return true;
    });
  }, [monthRows, categoryFilter, walletFilter]);

  const monthTotal = monthRows.reduce((s, r) => s + r.amountBase, 0);
  const prevTotal = prevRows.reduce((s, r) => s + r.amountBase, 0);
  const deltaPct = prevTotal > 0 ? ((monthTotal - prevTotal) / prevTotal) * 100 : null;
  const visibleTotal = visible.reduce((s, r) => s + r.amountBase, 0);
  const isFiltered = !!categoryFilter || !!walletFilter;

  // Avg daily uses elapsed days in the active month — for a past month, full
  // month length; for the current month, days-so-far. Past zero noise out.
  const daysElapsed = elapsedDaysOf(month);
  const avgDaily = daysElapsed > 0 ? monthTotal / daysElapsed : 0;

  // Category breakdown: top 5 categories by base total. Untagged rolls up.
  const categoryStats = useMemo(() => {
    const tally = new Map<string, number>();
    for (const r of monthRows) {
      if (r.categoryIds.length === 0) {
        tally.set("__untagged", (tally.get("__untagged") ?? 0) + r.amountBase);
        continue;
      }
      // Multi-tag rows split the amount evenly across tags so totals stay honest.
      const share = r.amountBase / r.categoryIds.length;
      for (const id of r.categoryIds) {
        tally.set(id, (tally.get(id) ?? 0) + share);
      }
    }
    const arr = Array.from(tally.entries())
      .map(([id, value]) => ({
        id,
        name: id === "__untagged" ? "Untagged" : categoryNameById.get(id) ?? "Untagged",
        value,
      }))
      .sort((a, b) => b.value - a.value);
    return arr.slice(0, 5);
  }, [monthRows, categoryNameById]);

  // Business vs personal split: simple amountBase tally.
  const businessTotal = monthRows
    .filter((r) => r.businessRelevant)
    .reduce((s, r) => s + r.amountBase, 0);
  const personalTotal = monthTotal - businessTotal;

  // Top vendors / descriptions: group by lower-cased trimmed description.
  const topVendors = useMemo(() => {
    const tally = new Map<string, { label: string; total: number; count: number }>();
    for (const r of monthRows) {
      const raw = r.description?.trim();
      if (!raw) continue;
      const key = raw.toLowerCase();
      const cur = tally.get(key);
      if (cur) {
        cur.total += r.amountBase;
        cur.count += 1;
      } else {
        tally.set(key, { label: raw, total: r.amountBase, count: 1 });
      }
    }
    return Array.from(tally.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);
  }, [monthRows]);

  const showRecoveryCaption =
    isCurrentMonth(month) && safeToSpendBaseline.inRecovery;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <PageMonthNav
        value={month}
        onChange={setMonthValue}
        maxMonth={currentMonthValue()}
        summary={
          <>
            <MonthNavStat
              label="Spent"
              value={formatMoney(monthTotal, baseCurrency, { compact: true })}
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
            <MonthNavStat
              label="Avg/day"
              value={formatMoney(avgDaily, baseCurrency, { compact: true })}
            />
            <MonthNavStat label="Spends" value={monthRows.length} />
          </>
        }
      />

      {/* Per-month stats panel — bird's eye stats for the active month. */}
      <section className="mt-5 grid gap-3 md:grid-cols-3">
        {/* Hero total + delta */}
        <div className="paper-grain rounded-[12px] border border-foreground/10 bg-card/40 p-4 md:col-span-1">
          <div className="display-eyebrow text-muted-foreground">
            Total spent
          </div>
          <motion.div
            key={`${month.year}-${month.month}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: EASE }}
            className="mt-2"
          >
            <NumberFlow
              value={Math.round(monthTotal)}
              format={{
                style: "currency",
                currency: baseCurrency,
                maximumFractionDigits: 0,
              }}
              transformTiming={{
                duration: 600,
                easing: "cubic-bezier(0.22, 1, 0.36, 1)",
              }}
              className="font-fraunces display-numeric tabular text-[clamp(36px,5.5vw,52px)] leading-none text-foreground"
            />
          </motion.div>
          <div className="mt-3 flex items-baseline gap-2 text-[12px] text-muted-foreground">
            {deltaPct === null ? (
              <span>No baseline last month.</span>
            ) : (
              <span className="inline-flex items-center gap-1">
                {deltaPct > 0 ? (
                  <ArrowUpRight className="h-3 w-3 text-[var(--color-warning,theme(colors.orange.400))]" />
                ) : (
                  <ArrowDownRight className="h-3 w-3 text-[var(--color-positive,theme(colors.lime.400))]" />
                )}
                <span
                  className={cn(
                    "tabular font-medium",
                    deltaPct > 0
                      ? "text-[var(--color-warning,theme(colors.orange.400))]"
                      : "text-[var(--color-positive,theme(colors.lime.400))]",
                  )}
                >
                  {Math.abs(deltaPct).toFixed(0)}%
                </span>
                <span>vs {formatMoney(prevTotal, baseCurrency, { compact: true })} prev</span>
              </span>
            )}
          </div>
          {showRecoveryCaption && (
            <div className="mt-3 rounded-[8px] border-l-2 border-[var(--color-warning,theme(colors.orange.400))] bg-foreground/[0.03] py-1.5 pl-2 pr-2 text-[11px] leading-snug text-muted-foreground">
              Recovery mode — trailing spend ran ahead of income. Daily floor
              softened {formatMoney(safeToSpendBaseline.recoveryDailyTaxBase, baseCurrency, { compact: true })}/day.
            </div>
          )}
        </div>

        {/* Category breakdown — top 5 with mini bars */}
        <div className="rounded-[12px] border border-foreground/10 bg-card/40 p-4 md:col-span-1">
          <div className="flex items-baseline justify-between">
            <div className="display-eyebrow text-muted-foreground">By category</div>
            <span className="text-[11px] text-muted-foreground/70">top 5</span>
          </div>
          {categoryStats.length === 0 ? (
            <p className="mt-4 text-[12px] text-muted-foreground">Nothing this month.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {categoryStats.map((c) => {
                const pct = monthTotal > 0 ? (c.value / monthTotal) * 100 : 0;
                return (
                  <li key={c.id} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2 text-[12px]">
                      <span className="truncate text-foreground/85">{c.name}</span>
                      <span className="tabular text-muted-foreground">
                        {formatMoney(c.value, baseCurrency, { compact: true })}
                        <span className="ml-1.5 text-muted-foreground/55">
                          {pct.toFixed(0)}%
                        </span>
                      </span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-foreground/[0.06]">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.7, ease: EASE }}
                        className="h-full rounded-full bg-[var(--brand)]"
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Business vs personal + top vendors */}
        <div className="rounded-[12px] border border-foreground/10 bg-card/40 p-4 md:col-span-1">
          <div className="display-eyebrow text-muted-foreground">Mix</div>
          {monthTotal === 0 ? (
            <p className="mt-4 text-[12px] text-muted-foreground">Nothing this month.</p>
          ) : (
            <div className="mt-3 space-y-3">
              <BusinessPersonalSplit
                businessTotal={businessTotal}
                personalTotal={personalTotal}
                baseCurrency={baseCurrency}
              />
              {topVendors.length > 0 && (
                <div className="border-t border-foreground/10 pt-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                    Top vendors
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {topVendors.map((v) => (
                      <li
                        key={v.label}
                        className="flex items-baseline justify-between gap-2 text-[12px]"
                      >
                        <span className="truncate text-foreground/85">{v.label}</span>
                        <span className="tabular text-muted-foreground">
                          {formatMoney(v.total, baseCurrency, { compact: true })}
                          {v.count > 1 && (
                            <span className="ml-1 text-muted-foreground/55">
                              ×{v.count}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Filters — compact chip rows. Month is the URL, not a chip. */}
      <section className="mt-5">
        <div className="flex flex-col gap-2">
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

      {/* Dense list */}
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

      <FloatingLogButton onClick={openFresh} />

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

function BusinessPersonalSplit({
  businessTotal,
  personalTotal,
  baseCurrency,
}: {
  businessTotal: number;
  personalTotal: number;
  baseCurrency: CurrencyCode;
}) {
  const total = businessTotal + personalTotal;
  const bizPct = total > 0 ? (businessTotal / total) * 100 : 0;
  const persPct = 100 - bizPct;
  return (
    <div className="space-y-2">
      <div className="flex h-2 overflow-hidden rounded-full bg-foreground/[0.06]">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${bizPct}%` }}
          transition={{ duration: 0.7, ease: EASE }}
          className="h-full bg-[var(--brand)]"
        />
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${persPct}%` }}
          transition={{ duration: 0.7, delay: 0.05, ease: EASE }}
          className="h-full bg-foreground/30"
        />
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-[var(--brand)]" />
          <span className="text-muted-foreground">Business</span>
          <span className="ml-auto tabular text-foreground">
            {formatMoney(businessTotal, baseCurrency, { compact: true })}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-foreground/30" />
          <span className="text-muted-foreground">Personal</span>
          <span className="ml-auto tabular text-foreground">
            {formatMoney(personalTotal, baseCurrency, { compact: true })}
          </span>
        </div>
      </div>
    </div>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
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
  const tagNames = row.categoryIds
    .map((id) => categoryNameById.get(id))
    .filter((n): n is string => !!n);

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
          <span className="truncate text-[13px] text-foreground">
            {row.description?.trim() || (
              <span className="text-muted-foreground/60">—</span>
            )}
          </span>
          {row.businessRelevant && (
            <span
              aria-label="Business-relevant"
              title="Business-relevant"
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]"
            />
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
          <span>{row.walletName}</span>
          {tagNames.length > 0 && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-muted-foreground/85">
                {tagNames.join(", ")}
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
    // Past month — return its full day count.
    return Math.round((nextMonth.getTime() - monthStart.getTime()) / 86_400_000);
  }
  // Current month — days elapsed including today.
  return now.getDate();
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
