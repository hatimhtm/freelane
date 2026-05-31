"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Plus } from "lucide-react";
import NumberFlow from "@number-flow/react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Sparkline } from "@/components/stats/sparkline";
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
import { SpendSheet, type WalletOpt, type SpendSheetDefaults } from "./spend-sheet";

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

type MonthKey = "this" | "last" | "all";

export function SpendingView({
  rows,
  categories,
  wallets,
  currencies,
  rates,
  baseCurrency,
  spentThisMonth,
  series,
  safeToSpendBaseline,
  recentSpends,
  spendCategoryLinks,
  spendItems,
  priceIntelCache,
  openNew,
  defaultCategoryId,
}: {
  rows: SpendRow[];
  categories: SpendCategory[];
  wallets: WalletOpt[];
  currencies: string[];
  rates: { code: string; rate_to_base: number }[];
  baseCurrency: CurrencyCode;
  spentThisMonth: number;
  series: number[];
  safeToSpendBaseline: SafeToSpendBreakdown;
  recentSpends: Spend[];
  spendCategoryLinks: SpendCategoryLink[];
  spendItems: SpendItem[];
  priceIntelCache?: PriceIntelligenceRow[];
  openNew?: boolean;
  defaultCategoryId?: string;
}) {
  const [sheetOpen, setSheetOpen] = useState(openNew ?? false);
  const [sheetDefaults, setSheetDefaults] = useState<SpendSheetDefaults | undefined>(
    defaultCategoryId ? { categoryId: defaultCategoryId } : undefined,
  );
  const [categoryFilter, setCategoryFilter] = useState<string>(""); // "" = all
  const [walletFilter, setWalletFilter] = useState<string>("");
  const [monthFilter, setMonthFilter] = useState<MonthKey>("this");

  // External openers (e.g. SadakaQuickLogButton on /today). One global event,
  // one sheet — keeps the form's state machine in a single place.
  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent).detail as SpendSheetDefaults | undefined;
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

  // Wallet chips reflect actually-used wallets; never show empties.
  const usedWalletIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of rows) ids.add(r.walletId);
    return ids;
  }, [rows]);
  const walletChips = useMemo(
    () => wallets.filter((w) => usedWalletIds.has(w.id)),
    [wallets, usedWalletIds],
  );

  const monthRange = useMemo(() => monthBounds(monthFilter), [monthFilter]);

  const visible = useMemo(() => {
    return rows.filter((r) => {
      if (monthRange) {
        const t = new Date(r.spentAt).getTime();
        if (t < monthRange.start || t >= monthRange.end) return false;
      }
      if (categoryFilter && !r.categoryIds.includes(categoryFilter)) return false;
      if (walletFilter && r.walletId !== walletFilter) return false;
      return true;
    });
  }, [rows, categoryFilter, walletFilter, monthRange]);

  const visibleTotal = visible.reduce((sum, r) => sum + r.amountBase, 0);
  const isFiltered = !!categoryFilter || !!walletFilter || monthFilter !== "this";

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
      <PageHeader title="Spending" description="Every coin that left, calmly logged." />

      <section className="paper-grain mt-12 pb-2">
        <div className="display-eyebrow text-ink/55">Spent this month</div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.08, ease: EASE }}
          className="mt-5 flex items-baseline gap-4"
        >
          <NumberFlow
            value={Math.round(spentThisMonth)}
            format={{ style: "currency", currency: "PHP", maximumFractionDigits: 0 }}
            transformTiming={{ duration: 700, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}
            className="font-fraunces display-numeric tabular text-[clamp(56px,9vw,96px)] text-ink"
          />
        </motion.div>
        {series.length > 1 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.34, ease: EASE }}
            className="mt-6 max-w-md"
          >
            <Sparkline data={series} filled height={48} color="var(--brand)" />
            <div className="mt-2 text-[11px] uppercase tracking-[0.18em] text-ink/45">
              Last 30 days
            </div>
          </motion.div>
        )}
      </section>

      <section className="mt-14">
        <div className="display-eyebrow text-ink/55">Filters</div>
        <div className="mt-4 flex flex-col gap-3">
          <ChipRow>
            <Chip active={monthFilter === "this"} onClick={() => setMonthFilter("this")}>
              This month
            </Chip>
            <Chip active={monthFilter === "last"} onClick={() => setMonthFilter("last")}>
              Last month
            </Chip>
            <Chip active={monthFilter === "all"} onClick={() => setMonthFilter("all")}>
              All time
            </Chip>
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
                  onClick={() => setCategoryFilter(categoryFilter === c.id ? "" : c.id)}
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
          <div className="mt-5 flex items-baseline justify-between text-[13px] text-ink/65">
            <span>
              {visible.length} {visible.length === 1 ? "spend" : "spends"}
            </span>
            <span className="tabular text-ink">
              {formatMoney(visibleTotal, baseCurrency, { compact: true })}
            </span>
          </div>
        )}
      </section>

      <section className="mt-10">
        {rows.length === 0 ? (
          <EmptyState
            title="Nothing logged yet."
            description="The first spend you log starts a calmer rhythm — the rest follows."
            action={
              <button
                type="button"
                onClick={openFresh}
                className={cn(
                  "inline-flex h-10 items-center gap-1.5 rounded-lg px-4 text-[13px] font-medium tracking-tight",
                  "bg-[var(--brand)] text-[var(--brand-foreground)]",
                  "transition-[transform,filter] duration-300 ease-out",
                  "hover:brightness-[0.97] active:translate-y-px",
                )}
              >
                <Plus className="h-3.5 w-3.5" /> Log a spend
              </button>
            }
          />
        ) : visible.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-ink/55">
            Nothing matches these filters.
          </p>
        ) : (
          <ul className="border-t border-ink/10">
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

      <SpendSheet
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

function ChipRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
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
        "rounded-full border-[1.5px] px-3 py-1.5 text-[13px] font-medium",
        "transition-colors duration-300 ease-out",
        active
          ? "border-ink bg-ink text-paper"
          : "border-ink/20 text-ink/75 hover:bg-ink/[0.05] hover:text-ink",
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
      transition={{ duration: 0.32, delay: Math.min(index, 8) * 0.025, ease: EASE }}
      className="flex items-center gap-4 border-b border-ink/10 py-4"
    >
      <div className="w-14 shrink-0 text-[12px] tabular text-ink/55">
        {formatDate(row.spentAt)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] text-ink">
            {row.description?.trim() || <span className="text-ink/40">—</span>}
          </span>
          {row.businessRelevant && (
            <span
              aria-label="Business-relevant"
              title="Business-relevant"
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]"
            />
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink/55">
          <span>{row.walletName}</span>
          {tagNames.length > 0 && (
            <>
              <span className="text-ink/25">·</span>
              <span className="text-ink/60">{tagNames.join(", ")}</span>
            </>
          )}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="text-[15px] tabular text-ink">
          {formatMoney(row.amountBase, baseCurrency)}
        </div>
        {row.currency !== baseCurrency && (
          <div className="mt-0.5 text-[11px] tabular text-ink/45">
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
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.4, ease: EASE }}
      className={cn(
        "fixed right-5 bottom-5 z-30 inline-flex h-12 items-center gap-2 rounded-full px-5 text-[13px] font-medium tracking-tight",
        "bg-[var(--brand)] text-[var(--brand-foreground)]",
        "shadow-[0_14px_38px_-18px_oklch(from_var(--ink)_l_c_h_/_0.55)]",
        "transition-[transform,filter] duration-300 ease-out",
        "hover:brightness-[0.97] active:translate-y-px",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30",
        "sm:right-8 sm:bottom-8 sm:h-12",
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

function monthBounds(key: MonthKey): { start: number; end: number } | null {
  if (key === "all") return null;
  const now = new Date();
  if (key === "this") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { start: start.getTime(), end: end.getTime() };
  }
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: start.getTime(), end: end.getTime() };
}
