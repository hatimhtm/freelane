"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import {
  CenterModal,
  CenterModalBody,
  CenterModalFooter,
} from "@/components/ui/center-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WalletPickerWithBalance } from "@/components/app/wallet-picker";
import { formatMoney } from "@/lib/money";
import { playLanded } from "@/lib/sound";
import { phtToday } from "@/lib/utils";
import {
  addPaymentsReceivedBulk,
  consolidateClientMemoryAction,
  refreshRatesIfStale,
  type BulkPaymentRowInput,
} from "@/lib/data/actions";
import type { CurrencyCode } from "@/lib/supabase/types";

type ProjectOpt = {
  id: string;
  title: string;
  currency: CurrencyCode;
  clientName: string;
  outstanding: number;
};
type Rate = { code: string; rate_to_base: number };

// One editable line in the bulk grid. Amounts are kept as strings while the
// user types (empty ≠ 0) and parsed only on save.
type Row = {
  key: string;
  projectId: string;
  paidAt: string;
  gross: string;
  grossCurrency: string;
  fee: string; // in base currency
  landingMethodId: string | null;
};

let rowSeq = 0;
function blankRow(baseCurrency: string): Row {
  rowSeq += 1;
  return {
    key: `r${rowSeq}`,
    projectId: "",
    paidAt: phtToday(),
    gross: "",
    grossCurrency: baseCurrency,
    fee: "",
    landingMethodId: null,
  };
}

export function BulkPaymentModal({
  open,
  onOpenChange,
  projects,
  methods,
  balances,
  currencies,
  rates,
  baseCurrency,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projects: ProjectOpt[];
  methods: { id: string; name: string }[];
  balances: Map<string, number>;
  currencies: string[];
  rates: Rate[];
  baseCurrency: CurrencyCode;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [pending, start] = useTransition();

  // Seed three blank rows on open (a bulk entry is rarely a single payment —
  // if it were, the user would reach for the single-payment modal). Pull fresh
  // FX so the net/fee preview reflects today's rates.
  useEffect(() => {
    if (!open) return;
    setRows([blankRow(baseCurrency), blankRow(baseCurrency), blankRow(baseCurrency)]);
    refreshRatesIfStale(6)
      .then((r) => {
        if (r.refreshed) router.refresh();
      })
      .catch(() => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function toBase(amount: number, currency: string): number {
    if (currency === baseCurrency) return amount;
    const r = rates.find((x) => x.code === currency)?.rate_to_base ?? 1;
    return amount * r;
  }

  function patch(key: string, p: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, blankRow(baseCurrency)]);
  }
  function removeRow(key: string) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)));
  }

  function onProjectChange(key: string, projectId: string) {
    const p = projects.find((x) => x.id === projectId);
    patch(key, {
      projectId,
      grossCurrency: p?.currency ?? baseCurrency,
      gross: p && p.outstanding > 0 ? String(Math.round(p.outstanding * 100) / 100) : "",
    });
  }

  // A row counts toward the batch once it has a project and a positive gross.
  const filledRows = useMemo(
    () => rows.filter((r) => r.projectId && Number(r.gross) > 0),
    [rows],
  );

  const totals = useMemo(() => {
    let grossBase = 0;
    let feeBase = 0;
    for (const r of filledRows) {
      const g = toBase(Number(r.gross) || 0, r.grossCurrency);
      const fee = Math.max(0, Number(r.fee) || 0);
      grossBase += g;
      feeBase += Math.min(g, fee);
    }
    const net = Math.max(0, grossBase - feeBase);
    return { grossBase, feeBase, net, pct: grossBase > 0 ? feeBase / grossBase : 0 };
  }, [filledRows]); // eslint-disable-line react-hooks/exhaustive-deps

  function save() {
    if (filledRows.length === 0) {
      toast.error("Add at least one payment with a project and amount.");
      return;
    }
    const payload: BulkPaymentRowInput[] = filledRows.map((r) => ({
      project_id: r.projectId,
      paid_at: r.paidAt,
      gross_amount: Number(r.gross),
      gross_currency: r.grossCurrency,
      fee_base: Math.max(0, Number(r.fee) || 0),
      landing_method_id: r.landingMethodId,
    }));
    start(async () => {
      try {
        const res = await addPaymentsReceivedBulk(payload);
        if (res.created > 0) playLanded();
        if (res.errors.length === 0) {
          toast.success(
            `Logged ${res.created} payment${res.created === 1 ? "" : "s"} · ${formatMoney(totals.net, baseCurrency)} landed`,
          );
          onOpenChange(false);
        } else {
          toast.warning(
            `Logged ${res.created} of ${res.total} — ${res.errors.length} couldn't be saved (${res.errors[0].message})`,
          );
        }
        router.refresh();
        // Let each touched client's AI memory learn from the new income.
        for (const clientId of res.clientIds) {
          consolidateClientMemoryAction(clientId)
            .then(() => router.refresh())
            .catch(() => {});
        }
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <CenterModal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      className="sm:max-w-[680px]"
      title="Log several payments"
      description="One row per payment received. Enter the gross owed and the fee the rail ate — net landed is gross minus fee."
    >
      <CenterModalBody>
        <div className="grid gap-2 pt-1">
          {/* Column header — hidden on narrow screens where each row stacks. */}
          <div className="hidden grid-cols-[1.4fr_0.9fr_0.7fr_1fr_auto] items-center gap-2 px-1 text-[10px] uppercase tracking-wider text-muted-foreground sm:grid">
            <span>Project</span>
            <span>Gross</span>
            <span>Fee ({baseCurrency})</span>
            <span>Landed in</span>
            <span />
          </div>

          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {rows.map((r) => {
                const g = toBase(Number(r.gross) || 0, r.grossCurrency);
                const fee = Math.max(0, Number(r.fee) || 0);
                const net = Math.max(0, g - Math.min(g, fee));
                return (
                  <motion.div
                    key={r.key}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    className="rounded-[10px] border border-border/60 bg-muted/25 p-2.5"
                  >
                    <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-[1.4fr_0.9fr_0.7fr_1fr_auto]">
                      {/* Project */}
                      <div className="min-w-0 space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground sm:hidden">
                          Project
                        </Label>
                        <Select
                          items={projects.map((p) => ({
                            value: p.id,
                            label: `${p.title}${p.clientName ? ` · ${p.clientName}` : ""}`,
                          }))}
                          value={r.projectId}
                          onValueChange={(v) => v && onProjectChange(r.key, v)}
                        >
                          <SelectTrigger className="h-9 w-full text-sm">
                            <SelectValue placeholder="Pick a project" />
                          </SelectTrigger>
                          <SelectContent>
                            {projects.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.title}
                                {p.clientName ? ` · ${p.clientName}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Gross + currency */}
                      <div className="min-w-0 space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground sm:hidden">
                          Gross
                        </Label>
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            placeholder="0.00"
                            value={r.gross}
                            onChange={(e) => patch(r.key, { gross: e.target.value })}
                            className="h-9 flex-1 text-right text-sm tabular"
                          />
                          <Select
                            items={currencies.map((c) => ({ value: c, label: c }))}
                            value={r.grossCurrency}
                            onValueChange={(v) => v && patch(r.key, { grossCurrency: v })}
                          >
                            <SelectTrigger className="h-9 w-[68px] shrink-0 px-2 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {currencies.map((c) => (
                                <SelectItem key={c} value={c}>
                                  {c}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Fee (base) */}
                      <div className="min-w-0 space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground sm:hidden">
                          Fee ({baseCurrency})
                        </Label>
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          placeholder="0"
                          value={r.fee}
                          onChange={(e) => patch(r.key, { fee: e.target.value })}
                          className="h-9 w-full text-right text-sm tabular"
                        />
                      </div>

                      {/* Landing wallet */}
                      <div className="min-w-0 space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground sm:hidden">
                          Landed in
                        </Label>
                        <WalletPickerWithBalance
                          size="sm"
                          value={r.landingMethodId ?? ""}
                          onValueChange={(v) => patch(r.key, { landingMethodId: v || null })}
                          methods={methods}
                          balances={balances}
                          baseCurrency={baseCurrency}
                          placeholder="Wallet"
                          triggerClassName="h-9 text-xs"
                        />
                      </div>

                      {/* Remove */}
                      <div className="flex items-center justify-end sm:pt-1.5">
                        <button
                          type="button"
                          onClick={() => removeRow(r.key)}
                          disabled={rows.length <= 1}
                          className="grid size-8 place-items-center rounded-md text-muted-foreground/50 hover:text-destructive disabled:opacity-30"
                          aria-label="Remove row"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* Per-row net + date — date defaults to today, override inline. */}
                    <div className="mt-1.5 flex items-center justify-between gap-2 pl-0.5">
                      <Input
                        type="date"
                        value={r.paidAt}
                        onChange={(e) => patch(r.key, { paidAt: e.target.value })}
                        className="h-7 w-[150px] text-xs"
                      />
                      {r.projectId && Number(r.gross) > 0 && (
                        <span className="text-[11px] text-muted-foreground tabular">
                          net{" "}
                          <span className="font-medium text-foreground">
                            {formatMoney(net, baseCurrency, { compact: true })}
                          </span>
                          {fee > 0 && (
                            <span className="text-[var(--overdue)]">
                              {" "}· fee {formatMoney(Math.min(g, fee), baseCurrency, { compact: true })}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 self-start px-2 text-xs"
            onClick={addRow}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add row
          </Button>

          {/* Batch total */}
          <div className="mt-1 rounded-[10px] border border-[var(--success)]/40 bg-card px-3 py-2.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Total net landing · {filledRows.length} payment{filledRows.length === 1 ? "" : "s"}
              </span>
              <span className="text-xl font-semibold tabular">
                {formatMoney(totals.net, baseCurrency)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground tabular">
              <span>Gross {formatMoney(totals.grossBase, baseCurrency, { compact: true })}</span>
              <span className={totals.pct > 0 ? "text-[var(--overdue)]" : ""}>
                fees {formatMoney(totals.feeBase, baseCurrency, { compact: true })} ({(totals.pct * 100).toFixed(1)}%)
              </span>
            </div>
          </div>
        </div>
      </CenterModalBody>

      <CenterModalFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={save} disabled={pending || filledRows.length === 0}>
          {pending
            ? "Saving…"
            : `Log ${filledRows.length || ""} payment${filledRows.length === 1 ? "" : "s"}`}
        </Button>
      </CenterModalFooter>
    </CenterModal>
  );
}
