"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Wallet,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { motion, AnimatePresence } from "motion/react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import NumberFlow from "@number-flow/react";
import { PageHeader } from "@/components/app/page-header";
import { PrimaryAction } from "@/components/app/primary-action";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SWidget } from "@/components/widgets/s-widget";
import { WarningPill } from "@/components/widgets/warning-pill";
import { MethodGlyph } from "@/components/brand/method-glyph";
import {
  resolveWalletBrand,
  walletBrandTintStyle,
} from "@/lib/brand/wallets";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  updatePaymentDetails,
  consolidateClientMemoryAction,
  deleteWithdrawal,
} from "@/lib/data/actions";
import type { CurrencyCode } from "@/lib/supabase/types";
import type { HoldingBalanceRow } from "@/lib/payment-chain";
import type { WarningResult } from "@/lib/warnings/registry";
import { ChainModal } from "./chain-modal";
import { WithdrawalModal } from "./withdrawal-modal";
import { WalletDetailSheet } from "./wallet-detail-sheet";

export type ChainStepView = {
  order: number;
  fromName: string | null;
  toName: string;
  fromBrandKey: string | null;
  toBrandKey: string | null;
  amountIn: number;
  currencyIn: CurrencyCode;
  amountOut: number;
  currencyOut: CurrencyCode;
};

export type PaymentRow = {
  id: string;
  projectTitle: string;
  clientName: string;
  paidAt: string;
  amountIn: number;
  currencyIn: CurrencyCode;
  netBase: number;
  grossBase: number;
  feeBase: number;
  feePct: number;
  methodId: string | null;
  fromMethodId: string | null;
  landingName: string;
  landingBrandKey: string | null;
  feeUnknown: boolean;
  signature: string;
  steps: ChainStepView[];
  // Project status at load time — drives the History "status" filter chip
  // ("paid" / "partial" / "pending"). Stored per payment row so the chip
  // can narrow even when a project carries multiple payments.
  projectStatus: "paid" | "partial" | "pending";
};

export type HoldingRow = HoldingBalanceRow & { brandKey: string | null };

export type WithdrawalRow = {
  id: string;
  fromName: string;
  fromBrandKey: string | null;
  toName: string | null;
  toBrandKey: string | null;
  withdrawnAt: string;
  grossBase: number;
  netBase: number;
  feeBase: number;
  feePct: number;
};

type ChainProject = { id: string; title: string; currency: CurrencyCode; clientName: string; outstanding: number };

type PaymentsTab = "wallets" | "withdrawals" | "history";

const WALLETS_STORAGE_KEY = "freelane:payments:wallet-order:v1";

export function PaymentsView({
  rows,
  currency,
  methods,
  holdings,
  walletWarnings,
  anchorSetAtByMethod,
  withdrawals,
  holdingMethods,
  cashMethodId,
  openProjects,
  allProjects,
  allCurrencies,
  rates,
  openNew,
  openWithdraw,
  defaultProjectId,
  tab = "wallets",
}: {
  rows: PaymentRow[];
  currency: CurrencyCode;
  methods: { id: string; name: string; brandKey: string | null }[];
  holdings: HoldingRow[];
  walletWarnings: Map<string, WarningResult>;
  anchorSetAtByMethod: Map<string, string | null>;
  withdrawals: WithdrawalRow[];
  holdingMethods: { id: string; name: string; balance: number }[];
  cashMethodId?: string;
  openProjects: ChainProject[];
  allProjects: ChainProject[];
  allCurrencies: string[];
  rates: { code: string; rate_to_base: number }[];
  openNew?: boolean;
  openWithdraw?: boolean;
  defaultProjectId?: string;
  tab?: PaymentsTab;
}) {
  const showWallets = tab === "wallets";
  const showWithdrawals = tab === "withdrawals";
  const showHistory = tab === "history";
  const [sheetOpen, setSheetOpen] = useState(openNew ?? false);
  const [withdrawOpen, setWithdrawOpen] = useState(openWithdraw ?? false);
  const [activeWalletId, setActiveWalletId] = useState<string | null>(null);
  // Landing-wallet filter for the payments list ("" = all).
  const [landingFilter, setLandingFilter] = useState<string>("");
  // Period (date-range), client (multi-select), and status filters layered
  // on top of landingFilter. "all" period collapses the gte cutoff so the
  // list shows everything; client filter is a Set so multi-select adds up.
  const [periodFilter, setPeriodFilter] = useState<"7d" | "30d" | "90d" | "all">("all");
  const [clientFilter, setClientFilter] = useState<Set<string>>(() => new Set());
  const [statusFilter, setStatusFilter] = useState<"all" | "paid" | "partial" | "pending">("all");
  // Every currency that exists, base first — so newly-added ones are selectable.
  const currencies = useMemo(
    () => Array.from(new Set([currency, ...allCurrencies])),
    [currency, allCurrencies],
  );
  const formProjects = openProjects.length > 0 ? openProjects : allProjects;
  // Inline wallet balances for the chain-modal pickers — holding wallets show
  // their parked amount, non-holding methods omit it.
  const balancesByMethod = useMemo(
    () => new Map(holdings.map((h) => [h.methodId, h.balance])),
    [holdings],
  );
  const methodsBare = useMemo(
    () => methods.map((m) => ({ id: m.id, name: m.name })),
    [methods],
  );
  const methodBrandKeyById = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const opt of methods) m.set(opt.id, opt.brandKey);
    return m;
  }, [methods]);

  // Untagged is included as a chip whenever any row lacks a landing wallet
  // so the user can narrow to just those rows (rather than seeing them only
  // under "All"). Sort untagged last so it doesn't preempt named wallets.
  const landingNames = useMemo(() => {
    const named = Array.from(new Set(rows.map((r) => r.landingName))).filter(
      (n) => n && n !== "Untagged",
    );
    const hasUntagged = rows.some((r) => r.landingName === "Untagged");
    return hasUntagged ? [...named, "Untagged"] : named;
  }, [rows]);
  // Period cutoff in days. "all" collapses to null so the date filter is a
  // no-op. The cutoff is computed once per filter change rather than per
  // row so we don't allocate a Date() inside the .filter() loop.
  const periodCutoff = useMemo(() => {
    if (periodFilter === "all") return null;
    const days = periodFilter === "7d" ? 7 : periodFilter === "30d" ? 30 : 90;
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - days);
    return cutoff.getTime();
  }, [periodFilter]);
  // Distinct client names for the multi-select chip cluster. Sorted so the
  // chip order is stable across renders and stays alphabetised.
  const clientNames = useMemo(
    () => Array.from(new Set(rows.map((r) => r.clientName).filter((n): n is string => !!n && n !== "—"))).sort(),
    [rows],
  );
  const visibleRows = useMemo(() => {
    return rows.filter((r) => {
      if (landingFilter && r.landingName !== landingFilter) return false;
      if (clientFilter.size > 0 && !clientFilter.has(r.clientName)) return false;
      if (statusFilter !== "all" && r.projectStatus !== statusFilter) return false;
      if (periodCutoff !== null) {
        const t = new Date(r.paidAt).getTime();
        if (!Number.isFinite(t) || t < periodCutoff) return false;
      }
      return true;
    });
  }, [rows, landingFilter, clientFilter, statusFilter, periodCutoff]);
  const canWithdraw = holdingMethods.length > 0;
  // Paginated history. Reset to page 1 when ANY filter mutates so the user
  // doesn't get stuck on an empty trailing page after narrowing.
  const HISTORY_PAGE_SIZE = 25;
  const [historyPage, setHistoryPage] = useState(1);
  useEffect(() => {
    setHistoryPage(1);
  }, [landingFilter, periodFilter, clientFilter, statusFilter]);
  // Toggle helper for the multi-select client chip cluster.
  function toggleClient(name: string) {
    setClientFilter((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }
  const historySlice = useMemo(
    () => visibleRows.slice(0, historyPage * HISTORY_PAGE_SIZE),
    [visibleRows, historyPage],
  );
  const hasMoreHistory = visibleRows.length > historySlice.length;

  const activeWallet = useMemo(
    () => holdings.find((h) => h.methodId === activeWalletId) ?? null,
    [holdings, activeWalletId],
  );

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 lg:px-10 lg:py-12">
      <PageHeader
        title={
          showWithdrawals
            ? "Payments · Withdrawals"
            : showHistory
              ? "Payments · History"
              : "Payments"
        }
        description={
          showWithdrawals
            ? "Money pulled out of holding wallets — and the fees that ate it."
            : showHistory
              ? "Every payment, its chain, and what each rail cost."
              : "Wallets, parked amounts, and where the money rests."
        }
        actions={
          <div className="flex items-center gap-2">
            {(showWallets || showWithdrawals) && canWithdraw && (
              <Button variant="outline" onClick={() => setWithdrawOpen(true)}>
                <ArrowDownToLine className="mr-1.5 h-4 w-4" /> Log withdrawal
              </Button>
            )}
            {(showWallets || showHistory) && (
              <Button onClick={() => setSheetOpen(true)} disabled={allProjects.length === 0}>
                <Plus className="mr-1.5 h-4 w-4" /> Log payment
              </Button>
            )}
          </div>
        }
      />

      {/* Wallets — SortableGrid of S widgets, one per holding wallet.
          The Lifetime + Fees + Cheapest-ways cards moved off this page
          (stats chips → Dashboard, routing → chatbot). */}
      {showWallets && (
        <section className="mt-8">
          {holdings.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No holding wallets yet."
              description="Add a wallet in Settings to start tracking parked money."
            />
          ) : (
            <WalletSortableGrid
              holdings={holdings}
              warnings={walletWarnings}
              currency={currency}
              onOpen={(methodId) => setActiveWalletId(methodId)}
            />
          )}
        </section>
      )}

      {/* Withdrawals — compact Recent 3 + expandable full list. */}
      {showWithdrawals && (
        <section className="mt-8">
          <WithdrawalsSubview
            withdrawals={withdrawals}
            baseCurrency={currency}
            canWithdraw={canWithdraw}
            onOpenLog={() => setWithdrawOpen(true)}
          />
        </section>
      )}

      {/* History — paginated payment list with stacked filter clusters
          (landing wallet / period / client / status). Each cluster is its
          own chip row so the controls stay legible at narrow widths; all
          filters apply additively before the pagination slice. */}
      {showHistory && (
        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium">All payments</h2>
            {landingNames.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <FilterChip active={landingFilter === ""} onClick={() => setLandingFilter("")}>All</FilterChip>
                {landingNames.map((n) => (
                  <FilterChip key={n} active={landingFilter === n} onClick={() => setLandingFilter(n)}>{n}</FilterChip>
                ))}
              </div>
            )}
          </div>
          {rows.length > 0 && (
            <div className="mb-3 flex flex-col gap-2">
              <FilterChipGroup label="Period">
                <FilterChip active={periodFilter === "7d"} onClick={() => setPeriodFilter("7d")}>Last 7d</FilterChip>
                <FilterChip active={periodFilter === "30d"} onClick={() => setPeriodFilter("30d")}>Last 30d</FilterChip>
                <FilterChip active={periodFilter === "90d"} onClick={() => setPeriodFilter("90d")}>Last 90d</FilterChip>
                <FilterChip active={periodFilter === "all"} onClick={() => setPeriodFilter("all")}>All</FilterChip>
              </FilterChipGroup>
              {clientNames.length > 1 && (
                <FilterChipGroup label="Client">
                  {clientNames.map((n) => (
                    <FilterChip key={n} active={clientFilter.has(n)} onClick={() => toggleClient(n)}>{n}</FilterChip>
                  ))}
                  {clientFilter.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setClientFilter(new Set())}
                      className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  )}
                </FilterChipGroup>
              )}
              <FilterChipGroup label="Status">
                <FilterChip active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>All</FilterChip>
                <FilterChip active={statusFilter === "paid"} onClick={() => setStatusFilter("paid")}>Paid</FilterChip>
                <FilterChip active={statusFilter === "partial"} onClick={() => setStatusFilter("partial")}>Partial</FilterChip>
                <FilterChip active={statusFilter === "pending"} onClick={() => setStatusFilter("pending")}>Pending</FilterChip>
              </FilterChipGroup>
            </div>
          )}
          {rows.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="Nothing landed yet."
              description="Log your first payment and Freelane starts tracking what each rail really costs you."
              action={<Button onClick={() => setSheetOpen(true)} disabled={allProjects.length === 0}>Log a payment</Button>}
            />
          ) : visibleRows.length === 0 ? (
            <Card className="px-4 py-8 text-center text-sm text-muted-foreground">
              No payments match the current filters.
            </Card>
          ) : (
            <>
              <Card className="overflow-hidden p-0">
                {historySlice.map((r, i) => (
                  <PaymentItem
                    key={r.id}
                    row={r}
                    baseCurrency={currency}
                    methods={methodsBare}
                    methodBrandKeyById={methodBrandKeyById}
                    last={i === historySlice.length - 1}
                    index={i}
                  />
                ))}
              </Card>
              {hasMoreHistory && (
                <div className="mt-3 flex items-center justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setHistoryPage((p) => p + 1)}
                  >
                    Show more
                    <span className="ml-1.5 text-xs text-muted-foreground tabular">
                      {historySlice.length} of {visibleRows.length}
                    </span>
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      <ChainModal
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        projects={formProjects}
        methods={methodsBare}
        balances={balancesByMethod}
        currencies={currencies}
        rates={rates}
        baseCurrency={currency}
        defaultProjectId={defaultProjectId}
      />

      <WithdrawalModal
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        holdingMethods={holdingMethods}
        destinations={methodsBare}
        baseCurrency={currency}
        defaultToId={cashMethodId}
      />

      <WalletDetailSheet
        open={!!activeWallet}
        onOpenChange={(o) => {
          if (!o) setActiveWalletId(null);
        }}
        holding={activeWallet}
        baseCurrency={currency}
        anchorSetAt={activeWallet ? anchorSetAtByMethod.get(activeWallet.methodId) ?? null : null}
      />

      {/* PrimaryAction lives on the History tab — it's the surface that
          shows the full payment list, so the floating CTA reinforces the
          log action there. */}
      {showHistory && allProjects.length > 0 && (
        <PrimaryAction
          icon={Plus}
          label="Log a payment"
          ariaLabel="Open the payment log"
          onClick={() => setSheetOpen(true)}
        />
      )}
    </div>
  );
}

// ─── Wallet SortableGrid ─────────────────────────────────────────────
//
// S-widget grid of holding wallets. Brand-tinted background per wallet,
// 32px brand glyph in the corner, balance via NumberFlow. Per-browser
// order persists via localStorage. Whole-card click opens the wallet
// detail sheet. Inline warning pill renders only when the resolver
// returns active=true (CFG-within-tolerance never warns).

function WalletSortableGrid({
  holdings,
  warnings,
  currency,
  onOpen,
}: {
  holdings: HoldingRow[];
  warnings: Map<string, WarningResult>;
  currency: CurrencyCode;
  onOpen: (methodId: string) => void;
}) {
  const liveIds = useMemo(() => holdings.map((h) => h.methodId), [holdings]);
  const byId = useMemo(() => {
    const m = new Map<string, HoldingRow>();
    for (const h of holdings) m.set(h.methodId, h);
    return m;
  }, [holdings]);
  const [orderedIds, setOrderedIds] = useState<string[]>(liveIds);

  useEffect(() => {
    const saved = loadSavedOrder();
    setOrderedIds(reconcileOrder(saved, liveIds));
  }, [liveIds]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = orderedIds.indexOf(String(active.id));
    const to = orderedIds.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(orderedIds, from, to);
    setOrderedIds(next);
    persistOrder(next);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={orderedIds} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {orderedIds.map((id) => {
            const h = byId.get(id);
            if (!h) return null;
            return (
              <SortableWalletCell
                key={h.methodId}
                id={h.methodId}
                holding={h}
                warning={warnings.get(h.methodId)}
                currency={currency}
                onOpen={() => onOpen(h.methodId)}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function loadSavedOrder(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(WALLETS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return null;
  }
}

function persistOrder(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WALLETS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* quota or disabled storage — best effort */
  }
}

function reconcileOrder(saved: string[] | null, liveIds: string[]): string[] {
  const live = new Set(liveIds);
  const seen = new Set<string>();
  const result: string[] = [];
  if (saved) {
    for (const id of saved) {
      if (live.has(id) && !seen.has(id)) {
        result.push(id);
        seen.add(id);
      }
    }
  }
  for (const id of liveIds) {
    if (!seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  return result;
}

function SortableWalletCell({
  id,
  holding,
  warning,
  currency,
  onOpen,
}: {
  id: string;
  holding: HoldingRow;
  warning: WarningResult | undefined;
  currency: CurrencyCode;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const brand = resolveWalletBrand({ name: holding.name, brand_key: holding.brandKey ?? null });
  const tintStyle = walletBrandTintStyle(brand);
  const tone: "default" | "terracotta" | "rose" =
    holding.status === "over_overdraft"
      ? "rose"
      : holding.status === "within_tolerance"
        ? "terracotta"
        : "default";
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    cursor: isDragging ? "grabbing" : undefined,
    ...(tintStyle ?? {}),
  } as React.CSSProperties;

  // useSortable's `attributes` spread the keyboard-drag semantics
  // (role/tabIndex/aria-roledescription) onto the wrapper. We override the
  // aria-label so screen readers announce "Reorder <wallet> wallet" rather
  // than the default "Draggable item" — and the inner SWidget keeps its
  // own role=button for click-to-open behavior.
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-xl"
      aria-label={`Reorder ${holding.name} wallet`}
      {...attributes}
      {...listeners}
    >
      <SWidget
        label={brand.label}
        tone={tone}
        // Brand-tinted card → bare 32px glyph (spec). The tinted wrapper IS
        // the brand carrier; a neutral halo behind the glyph would muddy it.
        iconSlot="bare"
        icon={
          <MethodGlyph
            name={holding.name}
            brandKey={holding.brandKey}
            className="h-8 w-8"
          />
        }
        hero={
          <NumberFlow
            value={Math.round(holding.balance)}
            format={{ maximumFractionDigits: 0 }}
          />
        }
        sub={
          <span className="flex items-center gap-1.5">
            <span className="truncate">{holding.name}</span>
            <span aria-hidden className="text-muted-foreground/40">·</span>
            <span className="text-muted-foreground">{currency}</span>
          </span>
        }
        warning={
          warning?.active ? (
            <WarningPill
              detailHref={warning.detailHref ?? "/settings"}
              ariaLabel={
                warning.message
                  ? `${holding.name}: ${warning.message}`
                  : `${holding.name} needs attention`
              }
            >
              {warning.message ?? "Needs attention"}
            </WarningPill>
          ) : undefined
        }
        aiDot={{
          key: `payments.wallet.${holding.methodId}`,
          label: holding.name,
          data: {
            brandKey: holding.brandKey,
            balance: holding.balance,
            status: holding.status,
          },
        }}
        onOpen={onOpen}
      />
    </div>
  );
}

// ─── Withdrawals subview ────────────────────────────────────────────
//
// Compact list — Recent 3 by default, expand-on-click for the full list.

function WithdrawalsSubview({
  withdrawals,
  baseCurrency,
  canWithdraw,
  onOpenLog,
}: {
  withdrawals: WithdrawalRow[];
  baseCurrency: CurrencyCode;
  canWithdraw: boolean;
  onOpenLog: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? withdrawals : withdrawals.slice(0, 3);

  if (withdrawals.length === 0) {
    return (
      <EmptyState
        icon={ArrowDownToLine}
        title="No withdrawals yet."
        description="Pulling money out of a holding wallet — coin.ph to your bank, for instance — logs here so the fee count stays honest."
        action={
          canWithdraw ? (
            <Button onClick={onOpenLog}>
              <ArrowDownToLine className="mr-1.5 h-4 w-4" /> Log withdrawal
            </Button>
          ) : null
        }
      />
    );
  }

  // Only show the toggle when there's actually more than the visible 3 to
  // reveal — otherwise the control would be a dead affordance.
  const expandable = withdrawals.length > 3;
  return (
    <div className="flex flex-col gap-3">
      {expandable ? (
        <button
          type="button"
          className="flex items-center gap-2 text-left"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
        >
          <h2 className="text-sm font-medium">
            {showAll ? "All withdrawals" : "Recent withdrawals"}
          </h2>
          <span className="text-xs text-muted-foreground">
            {showAll ? `${withdrawals.length} total` : `showing 3 of ${withdrawals.length}`}
          </span>
          {/* ChevronDown rotates -180 when expanded — mirrors PaymentItem's
              chevron pattern so the two surfaces feel like one system. */}
          <ChevronDown
            className={cn(
              "size-3.5 text-muted-foreground transition-transform duration-200",
              showAll && "rotate-180",
            )}
          />
        </button>
      ) : (
        <h2 className="text-sm font-medium">
          Recent withdrawals
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {withdrawals.length} total
          </span>
        </h2>
      )}
      <Card className="overflow-hidden p-0">
        {visible.map((w, i) => (
          <WithdrawalItem
            key={w.id}
            row={w}
            baseCurrency={baseCurrency}
            last={i === visible.length - 1}
            index={i}
          />
        ))}
      </Card>
    </div>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active ? "border-foreground bg-foreground text-background" : "border-border/60 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function FilterChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function WithdrawalItem({
  row,
  baseCurrency,
  last,
  index,
}: {
  row: WithdrawalRow;
  baseCurrency: CurrencyCode;
  last: boolean;
  index: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  async function onConfirmDelete() {
    setBusy(true);
    try {
      await deleteWithdrawal(row.id);
      toast.success("Withdrawal removed");
      setConfirmOpen(false);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35, delay: Math.min(index, 6) * 0.04, ease: [0.16, 1, 0.3, 1] }}
        className={cn("group flex items-center gap-3 px-4 py-3.5", !last && "border-b border-border/50")}
      >
        <div className="flex shrink-0 items-center gap-1">
          <MethodGlyph name={row.fromName} brandKey={row.fromBrandKey} className="size-6" />
          {row.toName && (
            <>
              <ChevronRight className="size-3 text-muted-foreground/60" />
              <MethodGlyph name={row.toName} brandKey={row.toBrandKey} className="size-6" />
            </>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {row.fromName}{row.toName ? ` → ${row.toName}` : ""}
          </div>
          <div className="truncate text-xs text-muted-foreground tabular">
            {new Date(row.withdrawnAt).toLocaleDateString()} · out {formatMoney(row.grossBase, baseCurrency, { compact: true })}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-semibold tabular">{formatMoney(row.netBase, baseCurrency)}</div>
          <div className="text-[11px] text-[var(--overdue)] tabular">fee {formatMoney(row.feeBase, baseCurrency, { compact: true })} ({(row.feePct * 100).toFixed(1)}%)</div>
        </div>
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={busy}
          aria-label="Remove withdrawal"
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground/50 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 max-md:opacity-100"
        >
          <Trash2 className="size-3.5" />
        </button>
      </motion.div>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this withdrawal?</AlertDialogTitle>
            <AlertDialogDescription>
              Its fee stops counting and the wallet balance goes back up.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDelete} disabled={busy} variant="destructive">
              {busy ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function PaymentItem({
  row,
  baseCurrency,
  methods,
  methodBrandKeyById,
  last,
  index,
}: {
  row: PaymentRow;
  baseCurrency: CurrencyCode;
  methods: { id: string; name: string }[];
  methodBrandKeyById: Map<string, string | null>;
  last: boolean;
  index: number;
}) {
  const router = useRouter();
  const NONE = "__none__";
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(String(Math.round(row.netBase)));
  const [fromMethodId, setFromMethodId] = useState<string>(row.fromMethodId ?? NONE);
  const [methodId, setMethodId] = useState<string>(row.methodId ?? NONE);
  const [feeUnknown, setFeeUnknown] = useState(row.feeUnknown);
  const [saving, setSaving] = useState(false);
  const multi = row.steps.length > 1;

  async function saveDetails() {
    const net = Number(val);
    if (!feeUnknown && (!Number.isFinite(net) || net < 0)) {
      toast.error("Enter the amount you actually received, or tick “I don't know the fee”");
      return;
    }
    setSaving(true);
    try {
      const res = await updatePaymentDetails(row.id, {
        fromMethodId: fromMethodId === NONE ? null : fromMethodId,
        methodId: methodId === NONE ? null : methodId,
        netReceivedBase: net,
        feeUnknown,
      });
      toast.success(feeUnknown ? "Saved — fee left out of stats" : "Updated — fee recalculated");
      if (res.clientId) void consolidateClientMemoryAction(res.clientId);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cn(!last && "border-b border-border/50")}>
      <motion.button
        type="button"
        onClick={() => setOpen((o) => !o)}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35, delay: Math.min(index, 6) * 0.04, ease: [0.16, 1, 0.3, 1] }}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40"
      >
        {/* Brand glyph for the landing wallet — visual identity per row. */}
        <MethodGlyph
          name={row.landingName}
          brandKey={row.landingBrandKey}
          className="size-7 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{row.projectTitle}</div>
          <div className="truncate text-xs text-muted-foreground">
            {row.clientName} · {new Date(row.paidAt).toLocaleDateString()}<span className="hidden text-muted-foreground/80 sm:inline"> · {row.signature}</span>
          </div>
        </div>
        <FeeChip pct={row.feePct} />
        <div className="shrink-0 text-right">
          <div className="text-sm font-semibold tabular">{formatMoney(row.netBase, baseCurrency)}</div>
          {row.currencyIn !== baseCurrency && (
            <div className="text-[11px] text-muted-foreground tabular">from {formatMoney(row.amountIn, row.currencyIn, { compact: true })}</div>
          )}
        </div>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground/40 transition-transform duration-200", open && "rotate-180")} />
      </motion.button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden bg-muted/20"
          >
            <div className="space-y-1.5 px-4 py-3">
              {row.steps.map((s) => (
                <div key={s.order} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2">
                    <span className="inline-flex size-4 items-center justify-center rounded-full bg-foreground/10 font-mono text-[9px]">{s.order}</span>
                    <span className="font-medium">{s.fromName ? `${s.fromName} → ${s.toName}` : s.toName}</span>
                  </span>
                  <span className="tabular text-muted-foreground">
                    {formatMoney(s.amountIn, s.currencyIn, { compact: true })} → {formatMoney(s.amountOut, s.currencyOut, { compact: true })}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-border/50 pt-2 text-xs">
                <span className="text-muted-foreground">{multi ? "Total fee across the chain" : "Fee"}</span>
                <span className="tabular font-medium text-[var(--overdue)]">
                  {formatMoney(row.feeBase, baseCurrency, { compact: true })} ({(row.feePct * 100).toFixed(1)}%)
                </span>
              </div>

              {/* Edit a past payment: how you got paid + the real amount that
                  landed. Fee is gross − net, never a guessed %. Tick "I don't
                  know the fee" and it counts as 0 instead of guessing. */}
              <div className="mt-1 space-y-2.5 rounded-lg border border-border/50 bg-card/70 p-3">
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-foreground">From (source)</div>
                    <TagSelect
                      value={fromMethodId}
                      onChange={setFromMethodId}
                      methods={methods}
                      methodBrandKeyById={methodBrandKeyById}
                      none={NONE}
                      placeholder="Where it came from"
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-foreground">To (where it landed)</div>
                    <TagSelect
                      value={methodId}
                      onChange={setMethodId}
                      methods={methods}
                      methodBrandKeyById={methodBrandKeyById}
                      none={NONE}
                      placeholder="Where it landed"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <div className="mb-1 flex items-center justify-between text-[11px]">
                      <span className="font-medium text-foreground">Actual received ({baseCurrency})</span>
                      <span className="tabular text-muted-foreground">owed {formatMoney(row.grossBase, baseCurrency, { compact: true })}</span>
                    </div>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={feeUnknown ? "" : val}
                      disabled={feeUnknown}
                      placeholder={feeUnknown ? "fee ignored" : undefined}
                      onChange={(e) => setVal(e.target.value)}
                      className="h-8 w-full text-sm tabular"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
                    <Checkbox checked={feeUnknown} onCheckedChange={(c) => setFeeUnknown(c === true)} />
                    I don&apos;t know the fee (leave it out of fee stats)
                  </label>
                  <Button size="sm" className="h-8" disabled={saving} onClick={saveDetails}>
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TagSelect({
  value,
  onChange,
  methods,
  methodBrandKeyById,
  none,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  methods: { id: string; name: string }[];
  methodBrandKeyById: Map<string, string | null>;
  none: string;
  placeholder: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => v && onChange(v)}
    >
      <SelectTrigger className="h-8 w-full text-sm"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value={none}>Untagged</SelectItem>
        {methods.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            <span className="flex items-center gap-2">
              <MethodGlyph name={m.name} brandKey={methodBrandKeyById.get(m.id) ?? null} className="size-4" />
              <span className="truncate">{m.name}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FeeChip({ pct }: { pct: number }) {
  const tone = pct >= 0.04 ? "text-[var(--overdue)] bg-[var(--overdue)]/12" : pct >= 0.02 ? "text-[var(--chart-3)] bg-[var(--chart-3)]/12" : "text-[var(--success)] bg-[var(--success)]/12";
  return (
    <span className={cn("inline-block shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular", tone)}>
      {(pct * 100).toFixed(1)}%
    </span>
  );
}
