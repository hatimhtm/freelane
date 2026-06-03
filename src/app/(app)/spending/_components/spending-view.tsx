"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, Plus, Search, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { PageMonthNav, MonthNavStat, type MonthValue } from "@/components/app/page-month-nav";
import { EmptyState } from "@/components/app/empty-state";
import { SpendHeatmap, SpendHeatmapYear } from "@/components/spending/spend-heatmap";
import { SpendOverTime } from "@/components/spending/spend-over-time";
import {
  CategoryTrendSmallMultiples,
  TopCategoriesEyebrowInfo,
} from "@/components/spending/category-trend-small-multiples";
import { VendorIntelligence } from "@/components/spending/vendor-intelligence";
import { SpendAnomaliesPanel } from "@/components/spending/spend-anomalies-panel";
import { InvestmentVsConsumption } from "@/components/spending/investment-vs-consumption";
import { SpentWidget } from "@/components/widgets/spending/spent-widget";
import { LiveDailySafeWidget } from "@/components/widgets/spending/live-daily-safe-widget";
import { ThisMonthWidget } from "@/components/widgets/spending/this-month-widget";
import { extractVendorToken, vendorSlug } from "@/lib/spending/vendor-extract";
import { formatMoney } from "@/lib/money";
import { cn, msUntilNextPhtMidnight, phtDateString } from "@/lib/utils";
import { createCustomTagAction } from "../_actions/tag-actions";
import {
  resolveVendorIcon,
  normalizeVendorName,
  indexVendorIconCache,
} from "@/lib/brand/vendor-icon";
import type {
  CurrencyCode,
  PriceIntelligenceRow,
  Spend,
  SpendCategory,
  SpendCategoryLink,
  SpendItem,
  TagKind,
  VendorIconCacheRow,
} from "@/lib/supabase/types";
import type { SafeToSpendBreakdown } from "@/lib/safe-to-spend";
import type { SpendingAnomaly } from "@/lib/ai/spending-anomalies";
import { SpendModal, type WalletOpt, type SpendModalDefaults } from "./spend-modal";
import { VendorsSubview } from "./vendors-subview";
import type { VendorsSubviewRow, KnownVendorOption } from "@/lib/data/queries";

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
  // Legacy boolean shortcut for the "For us" audience pill. Pre-0083
  // spends carry this from Tier 2 F (migration 0034) without an audience
  // tag attached — the audience filter accepts EITHER for_us===true OR
  // the audience tag id, mirroring the business/personal fallback.
  forUs: boolean;
};

// Audience pill ids. Maps to one of the four pinned (seeded by 0083)
// audience rows in spend_categories. Resolved at first render against
// the user's seed rows (so we read by NAME not by id). "all" is a
// no-filter sentinel — not a row.
type AudienceKey = "all" | "business" | "personal" | "for_us";
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
  vendorIconCache,
  knownVendors,
  initialSafeForToday,
  liveSafeRemaining,
  liveSafeOvershoot,
  vendorsSubview,
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
  vendorIconCache?: VendorIconCacheRow[];
  // Vendors workflow — light projection of active vendors (id +
  // display_name + slug + aliases) so the spend modal can render the
  // "text input + matching-vendors dropdown" affordance without a
  // round-trip. Optional for graceful degradation: the modal still
  // accepts a free-form vendor name and lets the server resolve / auto-
  // create on save.
  knownVendors?: KnownVendorOption[];
  // BUG FIX #2 (LIVE DAILY SAFE) — server-loaded numbers. The page
  // upserts daily_safe_snapshots on first read of the day.
  initialSafeForToday?: number;
  liveSafeRemaining?: number;
  // Magnitude of today's overshoot (todaySpends - initialForToday) when
  // positive. The Live Daily Safe widget swaps subtitle to "₱X past
  // safe" terracotta when > 0 so the user keeps the magnitude signal.
  liveSafeOvershoot?: number;
  // Vendors workflow — payload for the /spending/vendors sub-view.
  // Optional because the Spends + Trends subtabs don't need it; the
  // vendors-sub-view-only page (page.tsx for /spending/vendors)
  // hydrates this branch.
  vendorsSubview?: {
    needsIdentification: VendorsSubviewRow[];
    active: VendorsSubviewRow[];
    archived: VendorsSubviewRow[];
  };
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
  const [audience, setAudience] = useState<AudienceKey>("all");
  const [categoryFilters, setCategoryFilters] = useState<Set<string>>(
    new Set(defaultCategoryId ? [defaultCategoryId] : []),
  );
  const [customFilters, setCustomFilters] = useState<Set<string>>(new Set());
  const [walletFilter, setWalletFilter] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [moreOpen, setMoreOpen] = useState(false);
  // Heatmap click-drill — filter the Spends list to a single PHT day
  // when the user picks a cell. Clearing happens on the same-cell
  // re-click or when month nav moves off the active month.
  const [selectedHeatmapDay, setSelectedHeatmapDay] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const m = searchParams.get("m");
    if (!m) return;
    const parsed = parseMonthSlug(m);
    if (parsed && (parsed.year !== month.year || parsed.month !== month.month)) {
      setMonth(parsed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // PHT midnight rollover — schedule a router.refresh() at the next
  // PHT-midnight so the snapshot/initialForToday transition reaches the
  // open tab without waiting for a manual reload. Re-schedule after each
  // fire; clear on unmount so navigation cancels the pending timer.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    function schedule() {
      const delay = msUntilNextPhtMidnight();
      timer = setTimeout(() => {
        router.refresh();
        schedule();
      }, delay);
    }
    schedule();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [router]);

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

  // One pass over `categories` that builds every per-kind index the page
  // needs: audience-id-to-key map (radio resolution), audience-id set
  // (per-row tag-display exclusion + the audience filter precedence
  // check), category/custom kind buckets for the filter dropdown, and
  // id→name for chip labels. types.ts:670 already declares `tag_kind` as
  // a non-optional TagKind so the legacy `(c as SpendCategory & {...})`
  // casts are gone.
  const { audienceTagIds, audienceIdSet, categoryTagsOnly, customTagsOnly, categoryNameById } =
    useMemo(() => {
      const tagIds = new Map<AudienceKey, string | null>([
        ["all", null],
        ["business", null],
        ["personal", null],
        ["for_us", null],
      ]);
      const idSet = new Set<string>();
      const cats: SpendCategory[] = [];
      const customs: SpendCategory[] = [];
      const nameById = new Map<string, string>();
      for (const c of categories) {
        nameById.set(c.id, c.name);
        const tk: TagKind = c.tag_kind ?? "category";
        if (tk === "audience") {
          idSet.add(c.id);
          const lower = c.name.toLowerCase();
          if (lower === "business") tagIds.set("business", c.id);
          else if (lower === "personal") tagIds.set("personal", c.id);
          else if (lower === "for us") tagIds.set("for_us", c.id);
          continue;
        }
        if (c.archived) continue;
        if (tk === "category") cats.push(c);
        else if (tk === "custom") customs.push(c);
      }
      cats.sort((a, b) => a.sort_order - b.sort_order);
      customs.sort((a, b) => a.sort_order - b.sort_order);
      return {
        audienceTagIds: tagIds,
        audienceIdSet: idSet,
        categoryTagsOnly: cats,
        customTagsOnly: customs,
        categoryNameById: nameById,
      };
    }, [categories]);

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

  // Vendor icon cache index keyed by normalized name. The resolver does
  // its own normalization, so the index is built once per render rather
  // than per row.
  const vendorIconCacheByName = useMemo(
    () => indexVendorIconCache(vendorIconCache ?? []),
    [vendorIconCache],
  );

  // Wallet chips reflect actually-used wallets in this month.
  const walletChips = useMemo(() => {
    const used = new Set(monthRows.map((r) => r.walletId));
    return wallets.filter((w) => used.has(w.id));
  }, [wallets, monthRows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const audienceId =
      audience === "all" ? null : audienceTagIds.get(audience) ?? null;
    return monthRows.filter((r) => {
      // Audience filter — radio. Post-0083 the source of truth is the
      // explicit audience-kind tag: if the row carries ANY audience-kind
      // tag, use those ids and ignore the legacy business_relevant / for_us
      // booleans. Only when the row has NO audience-kind tag attached do
      // we fall back to the legacy flags (covers spends saved before the
      // user had audience seeds). Inverting precedence this way stops the
      // case where a row tagged 'Personal' but flagged business_relevant=true
      // would silently pass the Business filter.
      if (audience !== "all") {
        const rowAudienceIds: string[] = [];
        for (const cid of r.categoryIds) {
          if (audienceIdSet.has(cid)) rowAudienceIds.push(cid);
        }
        if (rowAudienceIds.length > 0) {
          if (!audienceId || !rowAudienceIds.includes(audienceId)) return false;
        } else {
          // Legacy fallback — only spends without any audience tag.
          if (audience === "business" && !r.businessRelevant) return false;
          if (audience === "personal" && r.businessRelevant) return false;
          if (audience === "for_us" && !r.forUs) return false;
        }
      }
      // Category + custom — checkbox multi-select. Row must include
      // AT LEAST ONE of the active ids (OR semantics; same as Github's
      // label filter).
      if (categoryFilters.size > 0) {
        let matched = false;
        for (const cid of categoryFilters) {
          if (r.categoryIds.includes(cid)) {
            matched = true;
            break;
          }
        }
        if (!matched) return false;
      }
      if (customFilters.size > 0) {
        let matched = false;
        for (const cid of customFilters) {
          if (r.categoryIds.includes(cid)) {
            matched = true;
            break;
          }
        }
        if (!matched) return false;
      }
      if (walletFilter && r.walletId !== walletFilter) return false;
      // Heatmap click-drill — filter to a single PHT day when selected.
      if (selectedHeatmapDay) {
        const rowPhtDate = phtDateString(new Date(r.spentAt));
        if (rowPhtDate !== selectedHeatmapDay) return false;
      }
      if (q) {
        const haystack = `${r.description ?? ""} ${r.walletName}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [
    monthRows,
    audience,
    audienceTagIds,
    audienceIdSet,
    categoryFilters,
    customFilters,
    walletFilter,
    selectedHeatmapDay,
    search,
  ]);

  const monthTotal = monthRows.reduce((s, r) => s + r.amountBase, 0);
  const prevTotal = prevRows.reduce((s, r) => s + r.amountBase, 0);
  const deltaPct = prevTotal > 0 ? ((monthTotal - prevTotal) / prevTotal) * 100 : null;
  const visibleTotal = visible.reduce((s, r) => s + r.amountBase, 0);
  const isFiltered =
    audience !== "all" ||
    categoryFilters.size > 0 ||
    customFilters.size > 0 ||
    !!walletFilter ||
    search.trim().length > 0;

  const showRecoveryCaption =
    isCurrentMonth(month) && safeToSpendBaseline.inRecovery;

  // BUG FIX #2 — live numbers default to the breakdown's safeTodayBase
  // when the loader hasn't threaded the snapshot through (cold start +
  // graceful degradation).
  const liveRemaining =
    liveSafeRemaining != null ? liveSafeRemaining : safeToSpendBaseline.safeTodayBase;
  const initialForToday =
    initialSafeForToday != null ? initialSafeForToday : safeToSpendBaseline.safeTodayBase;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {(showSpends || showTrends) && (
        <PageMonthNav
          value={month}
          onChange={setMonthValue}
          maxMonth={currentMonthValue()}
          summary={
            <MonthNavStat
              label="Spent"
              value={formatMoney(monthTotal, baseCurrency, { compact: true })}
            />
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

      {/* Top hero row — TOP SECTION RESTYLE.
          Spent (M)  ·  Live Daily Safe (S)  ·  This Month (S).
          Replaces the legacy 5-cell StatStrip. */}
      {(showSpends || showTrends) && (
        <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <SpentWidget
              monthSpends={monthSpends}
              recentSpends={recentSpends}
              prevTotalBase={prevTotal}
              baseCurrency={baseCurrency}
            />
          </div>
          <LiveDailySafeWidget
            liveRemaining={liveRemaining}
            initialForToday={initialForToday}
            overshootBase={liveSafeOvershoot}
            currency={baseCurrency}
          />
          <ThisMonthWidget
            recentSpends={recentSpends}
            baseCurrency={baseCurrency}
          />
        </section>
      )}

      {/* GitHub-style trailing-1y heatmap. Replaces the per-month grid on
          the Spends subtab so the calendar-shape reads at the full year. */}
      {showSpends && (
        <section className="mt-5">
          <Panel
            eyebrow="Last 12 months"
            subtitle="Each cell is a day — darker means more spent."
          >
            <SpendHeatmapYear
              spends={recentSpends}
              baseCurrency={baseCurrency}
              selectedDay={selectedHeatmapDay}
              // Click-drill: filter the dense spends list below to the
              // selected ISO date. Click again on the same day to clear.
              onSelectDay={(iso) => {
                setSelectedHeatmapDay((prev) => (prev === iso ? null : iso));
              }}
            />
          </Panel>
        </section>
      )}

      {/* Trends subtab — full-width analytical surface. Keeps the
          monthly heatmap for navigation context. */}
      {showTrends && (
        <section className="mt-5 grid gap-4 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-3">
            <Panel eyebrow="Last 6 months" subtitle="Spend over time, base currency.">
              <SpendOverTime
                spends={spendsTrailing6mo}
                now={new Date()}
                baseCurrency={baseCurrency}
                height={180}
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

          <div className="space-y-4 lg:col-span-2">
            {anomalies.length > 0 && (
              <Panel eyebrow="What's drifting" subtitle="Numbers that broke their rhythm.">
                <div className="px-3 pb-3">
                  <SpendAnomaliesPanel anomalies={anomalies} />
                </div>
              </Panel>
            )}
            <Panel
              eyebrow="Top categories"
              subtitle="Trailing 6 months, by amount."
              eyebrowSuffix={<TopCategoriesEyebrowInfo />}
            >
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
              <VendorIntelligence spends={recentSpends} baseCurrency={baseCurrency} vendorIconCache={vendorIconCache} />
            </Panel>
          </div>
        </section>
      )}

      {showVendors && (
        <>
          {vendorsSubview ? (
            <VendorsSubview
              needsIdentification={vendorsSubview.needsIdentification}
              active={vendorsSubview.active}
              archived={vendorsSubview.archived}
              baseCurrency={baseCurrency}
              vendorIconCache={vendorIconCache ?? []}
            />
          ) : (
            <section className="mt-5 space-y-4">
              <div className="rounded-[14px] border border-foreground/10 bg-card/40 p-5">
                <div className="display-eyebrow text-muted-foreground">Vendors</div>
                <p className="mt-2 text-[13px] text-foreground/85">
                  Loading vendor data…
                </p>
              </div>
            </section>
          )}
        </>
      )}

      {/* Filter row — Spends subtab. Two-zone layout per the design:
          PROMINENT  : [All][Business][Personal][For us] (audience radio)
          DROPDOWN   : ⚙ More filters → Category checkboxes + Custom
                       checkboxes + "+ New tag" + Wallet + search. */}
      {showSpends && (
        <section className="mt-6">
          <div className="flex flex-wrap items-center gap-2">
            <AudiencePill active={audience === "all"} onClick={() => setAudience("all")}>
              All
            </AudiencePill>
            <AudiencePill
              active={audience === "business"}
              onClick={() => setAudience("business")}
            >
              Business
            </AudiencePill>
            <AudiencePill
              active={audience === "personal"}
              onClick={() => setAudience("personal")}
            >
              Personal
            </AudiencePill>
            <AudiencePill
              active={audience === "for_us"}
              onClick={() => setAudience("for_us")}
            >
              For us
            </AudiencePill>
            <span className="mx-1 h-5 w-px self-center bg-foreground/10" />
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[12px] font-medium",
                "transition-colors duration-200 ease-out",
                moreOpen
                  ? "border-foreground/35 bg-foreground/[0.06] text-foreground"
                  : "border-foreground/15 text-foreground/70 hover:bg-foreground/[0.05] hover:text-foreground",
              )}
            >
              <Settings2 className="h-3 w-3" />
              More filters
              <ChevronDown
                className={cn(
                  "h-3 w-3 transition-transform duration-200",
                  moreOpen && "rotate-180",
                )}
              />
            </button>
            <SearchInput value={search} onChange={setSearch} />
          </div>

          <AnimatePresence initial={false}>
            {moreOpen && (
              <motion.div
                key="more-filters"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22, ease: EASE }}
                className="overflow-hidden"
              >
                <MoreFiltersPanel
                  categoryTags={categoryTagsOnly}
                  customTags={customTagsOnly}
                  categoryFilters={categoryFilters}
                  setCategoryFilters={setCategoryFilters}
                  customFilters={customFilters}
                  setCustomFilters={setCustomFilters}
                  walletFilter={walletFilter}
                  setWalletFilter={setWalletFilter}
                  walletChips={walletChips}
                />
              </motion.div>
            )}
          </AnimatePresence>

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
                  audienceIdSet={audienceIdSet}
                  vendorIconCacheByName={vendorIconCacheByName}
                  index={i}
                />
              ))}
            </ul>
          )}
        </section>
      )}

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
        initialSafeForToday={initialForToday}
        liveSafeRemaining={liveRemaining}
        knownVendors={knownVendors ?? []}
        defaults={sheetDefaults}
      />
    </div>
  );
}

// ─────────────────────────── More filters dropdown ──
// Lives inside the AnimatePresence so the slide-down is smooth. Columns:
//   left:   Category checkboxes (predefined "what kind of spend" labels,
//           read-only — user can archive seeds in Settings but cannot
//           add new category-kind tags from this affordance)
//   middle: Custom checkboxes + "+ New tag" affordance (kind=custom)
//   right:  Wallet chip row
//
// Design intent (locked 2026-06-02 in freelane-spendings-design.md):
// every user-added tag is `kind=custom`. The category-kind list is the
// seeded taxonomy from migration 0083 — that's why only the Custom
// column carries the "+ New tag" input. The affordance dispatches
// createCustomTagAction (which routes through createSpendCategory with
// tagKind='custom' + createdByUser=true) and immediately checks the
// new tag id once the router refresh completes.
function MoreFiltersPanel({
  categoryTags,
  customTags,
  categoryFilters,
  setCategoryFilters,
  customFilters,
  setCustomFilters,
  walletFilter,
  setWalletFilter,
  walletChips,
}: {
  categoryTags: SpendCategory[];
  customTags: SpendCategory[];
  categoryFilters: Set<string>;
  setCategoryFilters: (next: Set<string>) => void;
  customFilters: Set<string>;
  setCustomFilters: (next: Set<string>) => void;
  walletFilter: string;
  setWalletFilter: (v: string) => void;
  walletChips: WalletOpt[];
}) {
  const router = useRouter();
  const [pendingTag, startCreate] = useTransition();
  const [draftCustomName, setDraftCustomName] = useState("");

  function toggle(set: Set<string>, id: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  function submitCustomTag(e: React.FormEvent) {
    e.preventDefault();
    const name = draftCustomName.trim();
    if (!name) return;
    startCreate(async () => {
      const res = await createCustomTagAction(name);
      if (!res.ok) {
        toast.error(res.error || "Couldn't add the tag.");
        return;
      }
      toast.success(`Tag added: ${name}`);
      setDraftCustomName("");
      router.refresh();
    });
  }

  return (
    <div className="mt-3 rounded-[10px] border border-foreground/10 bg-card/40 p-3.5">
      <div className="grid gap-4 sm:grid-cols-3">
        <FilterColumn label="Categories">
          {categoryTags.length === 0 ? (
            <p className="text-[11.5px] text-muted-foreground">
              No category tags yet.
            </p>
          ) : (
            <CheckboxList
              ids={categoryTags.map((c) => ({ id: c.id, name: c.name }))}
              selected={categoryFilters}
              onToggle={(id) =>
                toggle(categoryFilters, id, setCategoryFilters)
              }
            />
          )}
        </FilterColumn>
        <FilterColumn label="Custom">
          {customTags.length === 0 ? (
            <p className="text-[11.5px] text-muted-foreground">
              No custom tags yet.
            </p>
          ) : (
            <CheckboxList
              ids={customTags.map((c) => ({ id: c.id, name: c.name }))}
              selected={customFilters}
              onToggle={(id) => toggle(customFilters, id, setCustomFilters)}
            />
          )}
          <form onSubmit={submitCustomTag} className="mt-2 flex items-center gap-1.5">
            <input
              type="text"
              value={draftCustomName}
              onChange={(e) => setDraftCustomName(e.target.value)}
              placeholder="+ New tag"
              className="h-7 flex-1 rounded-md border border-foreground/15 bg-card/60 px-2 text-[12px] outline-none placeholder:text-muted-foreground/60 focus:border-foreground/35"
            />
            <button
              type="submit"
              disabled={pendingTag || !draftCustomName.trim()}
              className="h-7 rounded-md bg-foreground px-2 text-[11px] font-medium text-background transition-opacity disabled:opacity-40"
            >
              Add
            </button>
          </form>
        </FilterColumn>
        <FilterColumn label="Wallet">
          {walletChips.length === 0 ? (
            <p className="text-[11.5px] text-muted-foreground">
              No wallets used this month.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <Chip
                active={walletFilter === ""}
                onClick={() => setWalletFilter("")}
              >
                Any
              </Chip>
              {walletChips.map((w) => (
                <Chip
                  key={w.id}
                  active={walletFilter === w.id}
                  onClick={() =>
                    setWalletFilter(walletFilter === w.id ? "" : w.id)
                  }
                >
                  {w.name}
                </Chip>
              ))}
            </div>
          )}
        </FilterColumn>
      </div>
    </div>
  );
}

function FilterColumn({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      <div>{children}</div>
    </div>
  );
}

function CheckboxList({
  ids,
  selected,
  onToggle,
}: {
  ids: Array<{ id: string; name: string }>;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {ids.map((t) => (
        <li key={t.id}>
          <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] text-foreground/85">
            <input
              type="checkbox"
              checked={selected.has(t.id)}
              onChange={() => onToggle(t.id)}
              className="accent-foreground"
            />
            {t.name}
          </label>
        </li>
      ))}
    </ul>
  );
}

function Panel({
  eyebrow,
  subtitle,
  eyebrowSuffix,
  children,
}: {
  eyebrow: string;
  subtitle?: string;
  // Optional inline annotation rendered next to the eyebrow (e.g. an
  // info tooltip explaining overlap on "Top categories"). Keeps the
  // explanation at the header rather than duplicating it inside the
  // panel body.
  eyebrowSuffix?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[14px] border border-foreground/10 bg-card/40">
      <div className="flex items-baseline justify-between gap-3 border-b border-foreground/10 px-4 py-3">
        <span className="display-eyebrow flex items-center gap-1.5 text-muted-foreground">
          {eyebrow}
          {eyebrowSuffix}
        </span>
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

// Audience pills — radio-style. Stronger visual weight than category
// chips so the audience filter reads as the primary axis.
function AudiencePill({
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
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center rounded-full border px-3 text-[12.5px] font-medium",
        "transition-colors duration-200 ease-out",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-foreground/20 text-foreground/75 hover:bg-foreground/[0.05] hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
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
  audienceIdSet,
  vendorIconCacheByName,
  index,
}: {
  row: SpendRow;
  baseCurrency: CurrencyCode;
  categoryNameById: Map<string, string>;
  // Audience-kind tag ids — filtered out of the per-row label list so
  // the audience axis only renders in the prominent radio at the top
  // of the page, not as a duplicate chip on every row.
  audienceIdSet: Set<string>;
  vendorIconCacheByName: Map<string, VendorIconCacheRow>;
  index: number;
}) {
  const tags = row.categoryIds
    .filter((id) => !audienceIdSet.has(id))
    .map((id) => ({ id, name: categoryNameById.get(id) }))
    .filter((t): t is { id: string; name: string } => !!t.name);

  // Vendor link — only if the description resolves to a known/guessed vendor.
  const vendorMatch = row.description
    ? extractVendorToken(row.description)
    : { vendor: null, confidence: null };
  const vendorHref = vendorMatch.vendor
    ? `/spending/vendor/${vendorSlug(vendorMatch.vendor)}`
    : null;

  const vendorTokenForIcon = vendorMatch.vendor ?? row.description ?? "";
  const vendorIconCacheRow =
    vendorTokenForIcon
      ? vendorIconCacheByName.get(normalizeVendorName(vendorTokenForIcon)) ?? null
      : null;
  const resolved = vendorTokenForIcon
    ? resolveVendorIcon(vendorTokenForIcon, {
        cache: vendorIconCacheRow,
        className: "size-6",
      })
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

      {resolved && <div className="shrink-0">{resolved.icon}</div>}

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
