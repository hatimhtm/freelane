"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CenterModal,
  CenterModalBody,
  CenterModalFooter,
} from "@/components/ui/center-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MethodGlyph } from "@/components/brand/method-glyph";
import { formatMoney } from "@/lib/money";
import { cn, phtToday } from "@/lib/utils";
import {
  resolveWalletBrand,
  walletBrandTintStyle,
} from "@/lib/brand/wallets";
import { setWalletOpeningBalance } from "@/lib/data/actions";
import {
  loadWalletBalanceTrend,
  loadWalletLedgerPage,
  type WalletLedgerEntry,
  type WalletTrendPoint,
} from "@/lib/data/wallet-detail-actions";
import type { CurrencyCode } from "@/lib/supabase/types";
import type { HoldingRow } from "./payments-view";

// Wallet detail sheet — opens when a wallet S-widget is clicked.
//
// Renders the wallet headline (brand chip + balance + breakdown), a 30-day
// balance-trend sparkline, the inline anchor editor (delegates to
// setWalletOpeningBalance), and the paginated ledger entry list. Ledger
// + trend are fetched on open via dedicated server actions so the heavy
// queries don't run on every payments page load.

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  holding: HoldingRow | null;
  baseCurrency: CurrencyCode;
  anchorSetAt: string | null;
};

export function WalletDetailSheet({ open, onOpenChange, holding, baseCurrency, anchorSetAt }: Props) {
  const router = useRouter();
  const brand = useMemo(
    () =>
      holding
        ? resolveWalletBrand({ name: holding.name, brand_key: holding.brandKey ?? null })
        : null,
    [holding],
  );
  const tintStyle = brand ? walletBrandTintStyle(brand) : undefined;

  // Ledger + trend reset whenever the active wallet changes. We key the
  // effect on holding.methodId so re-opening the same wallet doesn't drop
  // the already-loaded page.
  const walletId = holding?.methodId ?? null;
  const [entries, setEntries] = useState<WalletLedgerEntry[]>([]);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingPage, setLoadingPage] = useState(false);
  const [trend, setTrend] = useState<WalletTrendPoint[]>([]);
  const [trendLoading, setTrendLoading] = useState(false);

  useEffect(() => {
    if (!open || !walletId) {
      setEntries([]);
      setTrend([]);
      setNextOffset(0);
      setHasMore(false);
      return;
    }
    let cancelled = false;
    setLoadingPage(true);
    setTrendLoading(true);
    void Promise.all([
      loadWalletLedgerPage(walletId, 0),
      loadWalletBalanceTrend(walletId),
    ]).then(([ledgerRes, trendRes]) => {
      if (cancelled) return;
      if (ledgerRes.ok) {
        setEntries(ledgerRes.data.entries);
        setNextOffset(ledgerRes.data.nextOffset);
        setHasMore(ledgerRes.data.hasMore);
      } else {
        toast.error(ledgerRes.error || "Couldn't load ledger.");
      }
      if (trendRes.ok) setTrend(trendRes.data);
      setLoadingPage(false);
      setTrendLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, walletId]);

  async function loadMore() {
    if (!walletId || loadingPage) return;
    setLoadingPage(true);
    const res = await loadWalletLedgerPage(walletId, nextOffset);
    setLoadingPage(false);
    if (!res.ok) {
      toast.error(res.error || "Couldn't load more entries.");
      return;
    }
    setEntries((prev) => [...prev, ...res.data.entries]);
    setNextOffset(res.data.nextOffset);
    setHasMore(res.data.hasMore);
  }

  return (
    <CenterModal
      open={open}
      onOpenChange={onOpenChange}
      title={holding?.name ?? "Wallet"}
      description={brand?.label ? `Brand · ${brand.label}` : "Wallet detail"}
      size="lg"
    >
      <CenterModalBody>
        {holding && brand ? (
          <div className="flex flex-col gap-5">
            <div
              className="flex items-center gap-3 rounded-xl border border-border/50 p-4"
              style={tintStyle}
            >
              <MethodGlyph
                name={holding.name}
                brandKey={holding.brandKey}
                className="size-9"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] uppercase tracking-wider text-muted-foreground">
                  {brand.label}
                </div>
                <div
                  className={cn(
                    "tabular text-2xl font-semibold",
                    holding.status === "over_overdraft" && "text-[oklch(0.65_0.22_25)]",
                    holding.status === "within_tolerance" && "text-[oklch(0.7_0.13_45)]",
                  )}
                >
                  {formatMoney(holding.balance, baseCurrency)}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {holding.status === "over_overdraft"
                    ? "over overdraft"
                    : holding.status === "within_tolerance"
                      ? "within tolerance"
                      : "parked now"}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 text-[12px]">
              <BreakdownStat label="Received" value={holding.received} baseCurrency={baseCurrency} />
              <BreakdownStat label="Withdrawn" value={holding.withdrawn} baseCurrency={baseCurrency} />
              <BreakdownStat label="Spent" value={holding.spent} baseCurrency={baseCurrency} />
            </div>

            <BalanceTrendBlock points={trend} loading={trendLoading} baseCurrency={baseCurrency} />

            <AnchorEditor
              walletId={holding.methodId}
              opening={holding.opening}
              anchorSetAt={anchorSetAt}
              baseCurrency={baseCurrency}
              onSaved={() => router.refresh()}
            />

            <LedgerList
              entries={entries}
              hasMore={hasMore}
              loading={loadingPage}
              baseCurrency={baseCurrency}
              onLoadMore={loadMore}
            />
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Pick a wallet to see its detail.</div>
        )}
      </CenterModalBody>
      <CenterModalFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </CenterModalFooter>
    </CenterModal>
  );
}

function BreakdownStat({
  label,
  value,
  baseCurrency,
}: {
  label: string;
  value: number;
  baseCurrency: CurrencyCode;
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-card/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 tabular text-sm font-medium">
        {formatMoney(value, baseCurrency, { compact: true })}
      </div>
    </div>
  );
}

// ─── Balance trend sparkline ───────────────────────────────────────
//
// Inline SVG sparkline driven by the 30-day running-balance series. No
// chart library — keeps the bundle lean and the visual identical to the
// rest of Freelane's hand-drawn sparkline style.

function BalanceTrendBlock({
  points,
  loading,
  baseCurrency,
}: {
  points: WalletTrendPoint[];
  loading: boolean;
  baseCurrency: CurrencyCode;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border/50 bg-card/60 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Last 30 days</div>
        <div className="h-12 animate-pulse rounded bg-muted/40" />
      </div>
    );
  }
  if (points.length === 0) {
    return null;
  }
  const min = Math.min(...points.map((p) => p.balance));
  const max = Math.max(...points.map((p) => p.balance));
  const range = max - min || 1;
  const width = 320;
  const height = 48;
  const stepX = width / Math.max(points.length - 1, 1);
  const path = points
    .map((p, i) => {
      const x = i * stepX;
      const y = height - ((p.balance - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const first = points[0].balance;
  const last = points[points.length - 1].balance;
  const delta = last - first;
  const deltaColor =
    delta > 0
      ? "text-[var(--success)]"
      : delta < 0
        ? "text-[var(--overdue)]"
        : "text-muted-foreground";
  return (
    <div className="rounded-lg border border-border/50 bg-card/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Last 30 days</div>
        <div className={cn("text-[11px] tabular font-medium", deltaColor)}>
          {delta >= 0 ? "+" : ""}
          {formatMoney(delta, baseCurrency, { compact: true })}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-12 w-full"
        aria-label="30-day balance trend"
      >
        <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-foreground/80" />
      </svg>
    </div>
  );
}

// ─── Inline anchor editor ──────────────────────────────────────────
//
// Lets the user re-anchor the wallet without leaving the sheet. Optimistic
// save → on success the router refreshes and the parent reloads the
// holdings + ledger window. Delegates to setWalletOpeningBalance so the
// activity log, cache invalidation, and Sadaka math all stay consistent.

function AnchorEditor({
  walletId,
  opening,
  anchorSetAt,
  baseCurrency,
  onSaved,
}: {
  walletId: string;
  opening: number;
  anchorSetAt: string | null;
  baseCurrency: CurrencyCode;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(phtToday());
  const [pending, start] = useTransition();

  function save() {
    const trimmed = amount.trim();
    if (trimmed === "") {
      toast.error("Type the new anchor amount.");
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      toast.error("Anchor must be a number.");
      return;
    }
    start(async () => {
      const res = await setWalletOpeningBalance({
        methodId: walletId,
        amount: n,
        amountCurrency: baseCurrency,
        dateOpt: date || phtToday(),
      });
      if (!res.ok) {
        toast.error(res.error || "Couldn't save anchor.");
        return;
      }
      toast.success("Anchor saved.");
      setAmount("");
      setOpen(false);
      onSaved();
    });
  }

  return (
    <div className="rounded-lg border border-border/50 bg-card/60 p-3 text-[12px]">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-muted-foreground">Anchor</div>
          <div className="mt-1 tabular">
            Opening{" "}
            <span className="font-medium text-foreground">
              {formatMoney(opening, baseCurrency)}
            </span>
            {anchorSetAt && (
              <>
                <span className="px-1.5 text-muted-foreground/40">·</span>
                set {new Date(anchorSetAt).toLocaleDateString()}
              </>
            )}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? "Cancel" : "Re-anchor"}
        </Button>
      </div>
      {open && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px_auto]">
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Amount ({baseCurrency})
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              autoFocus
              className="h-9 text-sm tabular"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Date</Label>
            <Input
              type="date"
              value={date}
              max={phtToday()}
              onChange={(e) => setDate(e.target.value || phtToday())}
              className="h-9 text-sm tabular"
            />
          </div>
          <div className="flex items-end">
            <Button size="sm" className="h-9 w-full sm:w-auto" disabled={pending} onClick={save}>
              {pending ? "Saving…" : "Save anchor"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Ledger entry list ─────────────────────────────────────────────
//
// One row per ledger entry — pill for related kind, signed amount, optional
// note. Newest first, paginated 25 at a time via the "Show more" button.

function LedgerList({
  entries,
  hasMore,
  loading,
  baseCurrency,
  onLoadMore,
}: {
  entries: WalletLedgerEntry[];
  hasMore: boolean;
  loading: boolean;
  baseCurrency: CurrencyCode;
  onLoadMore: () => void;
}) {
  if (loading && entries.length === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-card/60 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Ledger</div>
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-muted/40" />
          ))}
        </div>
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-card/60 p-3 text-[12px]">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Ledger</div>
        <div className="py-4 text-center text-muted-foreground">
          No ledger entries since the last anchor.
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border/50 bg-card/60 p-3">
      <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">Ledger</div>
      <div className="divide-y divide-border/40">
        {entries.map((e) => (
          <LedgerRow key={e.id} entry={e} baseCurrency={baseCurrency} />
        ))}
      </div>
      {hasMore && (
        <div className="mt-2 flex justify-center">
          <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loading}>
            {loading ? "Loading…" : "Show more"}
          </Button>
        </div>
      )}
    </div>
  );
}

function LedgerRow({
  entry,
  baseCurrency,
}: {
  entry: WalletLedgerEntry;
  baseCurrency: CurrencyCode;
}) {
  const positive = entry.amountBase > 0;
  const sign = positive ? "+" : "";
  const tone = positive
    ? "text-[var(--success)]"
    : entry.amountBase < 0
      ? "text-[var(--overdue)]"
      : "text-muted-foreground";
  // Friendlier label for the related-kind pill. Falls back to the raw
  // ledger kind when there's no related row (e.g. adjustment rows).
  const pillLabel = entry.relatedKind ?? entry.kind;
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-[12px]">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {pillLabel}
          </span>
          <span className="truncate text-muted-foreground">
            {new Date(entry.eventAt).toLocaleString()}
          </span>
        </div>
        {entry.note && (
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground/80">{entry.note}</div>
        )}
      </div>
      <div className={cn("shrink-0 tabular text-sm font-medium", tone)}>
        {sign}
        {formatMoney(entry.amountBase, baseCurrency, { compact: true })}
      </div>
    </div>
  );
}
