"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownToLine, ChevronDown, Plus, Trash2, Wallet } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
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
import { MetricTile } from "@/components/stats/stat";
import { MethodLeaderboard } from "@/components/app/method-leaderboard";
import { MethodGlyph } from "@/components/brand/method-glyph";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { updatePaymentDetails, consolidateClientMemoryAction, deleteWithdrawal } from "@/lib/data/actions";
import type { CurrencyCode } from "@/lib/supabase/types";
import type { MethodLeaderboardRow, HoldingBalanceRow } from "@/lib/payment-chain";
import { ChainModal } from "./chain-modal";
import { WithdrawalModal } from "./withdrawal-modal";

export type ChainStepView = {
  order: number;
  fromName: string | null;
  toName: string;
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
  feeUnknown: boolean;
  signature: string;
  steps: ChainStepView[];
};

export type HoldingRow = HoldingBalanceRow;

export type WithdrawalRow = {
  id: string;
  fromName: string;
  toName: string | null;
  withdrawnAt: string;
  grossBase: number;
  netBase: number;
  feeBase: number;
  feePct: number;
};

type ChainProject = { id: string; title: string; currency: CurrencyCode; clientName: string; outstanding: number };

type PaymentsTab = "wallets" | "withdrawals" | "history";

export function PaymentsView({
  rows,
  leaderboard,
  currency,
  receivedThisMonth,
  lifetime,
  feesThisMonth,
  methods,
  holdings,
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
  leaderboard: MethodLeaderboardRow[];
  currency: CurrencyCode;
  receivedThisMonth: number;
  lifetime: number;
  feesThisMonth: number;
  methods: { id: string; name: string }[];
  holdings: HoldingRow[];
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
  // Landing-wallet filter for the payments list ("" = all).
  const [landingFilter, setLandingFilter] = useState<string>("");
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

  const landingNames = useMemo(
    () => Array.from(new Set(rows.map((r) => r.landingName))).filter((n) => n && n !== "Untagged"),
    [rows],
  );
  const visibleRows = landingFilter ? rows.filter((r) => r.landingName === landingFilter) : rows;
  const canWithdraw = holdingMethods.length > 0;

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
              : "Wallets, balances, and the cheapest rails to get paid."
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

      {/* Wallets tab — 3-up metric grid + held-in-wallets grid + leaderboard. */}
      {showWallets && (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <MetricTile label="Landed this month" value={receivedThisMonth} currency={currency} accent />
            <MetricTile label="Lifetime" value={lifetime} currency={currency} delay={0.04} />
            <MetricTile label="Fees this month" value={feesThisMonth} currency={currency} hint="rails + FX + withdrawals" delay={0.08} />
          </div>

          {holdings.length > 0 && (
            <section className="mt-10">
              <div className="mb-3 flex items-end justify-between">
                <div>
                  <h2 className="text-sm font-medium">Held in wallets</h2>
                  <p className="text-xs text-muted-foreground">Money parked, waiting to be withdrawn</p>
                </div>
                {canWithdraw && (
                  <Button size="sm" variant="ghost" onClick={() => setWithdrawOpen(true)}>
                    <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" /> Withdraw
                  </Button>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {holdings.map((h) => (
                  <HoldingCard key={h.methodId} row={h} currency={currency} />
                ))}
              </div>
            </section>
          )}

          <section className="mt-10">
            <h2 className="mb-3 text-sm font-medium">Cheapest ways to get paid</h2>
            <MethodLeaderboard rows={leaderboard} baseCurrency={currency} />
          </section>
        </>
      )}

      {/* Withdrawals tab — full list, or an empty-state. */}
      {showWithdrawals && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-medium">Withdrawals</h2>
          {withdrawals.length === 0 ? (
            <EmptyState
              icon={ArrowDownToLine}
              title="No withdrawals yet."
              description="Pulling money out of a holding wallet — coin.ph to your bank, for instance — logs here so the fee count stays honest."
              action={
                canWithdraw ? (
                  <Button onClick={() => setWithdrawOpen(true)}>
                    <ArrowDownToLine className="mr-1.5 h-4 w-4" /> Log withdrawal
                  </Button>
                ) : null
              }
            />
          ) : (
            <Card className="overflow-hidden p-0">
              {withdrawals.map((w, i) => (
                <WithdrawalItem key={w.id} row={w} baseCurrency={currency} last={i === withdrawals.length - 1} />
              ))}
            </Card>
          )}
        </section>
      )}

      {/* History tab — full payments table with landing-wallet filter. */}
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
          {rows.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="Nothing landed yet."
              description="Log your first payment and Freelane starts tracking what each rail really costs you."
              action={<Button onClick={() => setSheetOpen(true)} disabled={allProjects.length === 0}>Log a payment</Button>}
            />
          ) : visibleRows.length === 0 ? (
            <Card className="px-4 py-8 text-center text-sm text-muted-foreground">No payments landed in {landingFilter}.</Card>
          ) : (
            <Card className="overflow-hidden p-0">
              {visibleRows.map((r, i) => (
                <PaymentItem key={r.id} row={r} baseCurrency={currency} methods={methods} last={i === visibleRows.length - 1} index={i} />
              ))}
            </Card>
          )}
        </section>
      )}

      <ChainModal
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        projects={formProjects}
        methods={methods}
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
        destinations={methods}
        baseCurrency={currency}
        defaultToId={cashMethodId}
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

function HoldingCard({ row, currency }: { row: HoldingRow; currency: CurrencyCode }) {
  // Surface the canonical walletStatus tri-state (positive / within tolerance
  // / over overdraft) instead of painting every wallet identically. Matches
  // NegativeWalletAlarm + the spend modal picker so the same row never reads
  // two different colors across surfaces.
  const balanceClass =
    row.status === "over_overdraft"
      ? "text-[oklch(0.65_0.22_25)]" // rose — alarm
      : row.status === "within_tolerance"
        ? "text-[oklch(0.7_0.13_45)]" // terracotta — soft attention
        : "";
  const caption =
    row.status === "over_overdraft"
      ? "over overdraft"
      : row.status === "within_tolerance"
        ? "within tolerance"
        : "parked now";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <MethodGlyph name={row.name} className="size-5" />
          <span className="text-sm font-medium">{row.name}</span>
        </div>
        <div className={cn("mt-3 text-2xl font-semibold tabular", balanceClass)}>
          {formatMoney(row.balance, currency, { compact: true })}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">{caption}</div>
        <div className="mt-3 flex items-center justify-between border-t border-border/50 pt-2 text-[11px] text-muted-foreground tabular">
          <span>received {formatMoney(row.received, currency, { compact: true })}</span>
          <span>withdrawn {formatMoney(row.withdrawn, currency, { compact: true })}</span>
        </div>
      </Card>
    </motion.div>
  );
}

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

function WithdrawalItem({ row, baseCurrency, last }: { row: WithdrawalRow; baseCurrency: CurrencyCode; last: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function onDelete() {
    if (!confirm("Remove this withdrawal? Its fee stops counting and the wallet balance goes back up.")) return;
    setBusy(true);
    try {
      await deleteWithdrawal(row.id);
      toast.success("Withdrawal removed");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={cn("group flex items-center gap-3 px-4 py-3.5", !last && "border-b border-border/50")}>
      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--overdue)]/10 text-[var(--overdue)]">
        <ArrowDownToLine className="size-4" />
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
        onClick={onDelete}
        disabled={busy}
        aria-label="Remove withdrawal"
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground/50 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 max-md:opacity-100"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

function PaymentItem({ row, baseCurrency, methods, last, index }: { row: PaymentRow; baseCurrency: CurrencyCode; methods: { id: string; name: string }[]; last: boolean; index: number }) {
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
                    <TagSelect value={fromMethodId} onChange={setFromMethodId} methods={methods} none={NONE} placeholder="Where it came from" />
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-foreground">To (where it landed)</div>
                    <TagSelect value={methodId} onChange={setMethodId} methods={methods} none={NONE} placeholder="Where it landed" />
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
  value, onChange, methods, none, placeholder,
}: {
  value: string; onChange: (v: string) => void; methods: { id: string; name: string }[]; none: string; placeholder: string;
}) {
  return (
    <Select
      items={[{ value: none, label: "Untagged" }, ...methods.map((m) => ({ value: m.id, label: m.name }))]}
      value={value}
      onValueChange={(v) => v && onChange(v)}
    >
      <SelectTrigger className="h-8 w-full text-sm"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value={none}>Untagged</SelectItem>
        {methods.map((m) => (
          <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
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
