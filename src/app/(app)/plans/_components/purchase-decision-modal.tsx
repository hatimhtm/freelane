"use client";

import { useEffect, useState, useTransition } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  confirmPlanBought,
  runDecisionSupport,
} from "@/app/(app)/plans/_actions/plan-actions";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode, PlannedSpend } from "@/lib/supabase/types";
import type { PlanPurchaseDecisionResult } from "@/lib/ai/brains/plan-purchase-decision-support";
import type { WalletOpt } from "@/app/(app)/spending/_components/spend-modal";

// Pre-purchase decision support modal. Soft check only — the user can
// "Confirm anyway" regardless of the brain's recommendation. The brain
// runs FRESH each open (no cache); on confirm the markPlanBought flow
// writes a real spend and schedules the +14d plan_satisfaction_check.

export function PurchaseDecisionModal({
  open,
  onOpenChange,
  plan,
  wallets,
  baseCurrency,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  plan: PlannedSpend;
  wallets: WalletOpt[];
  baseCurrency: CurrencyCode;
}) {
  const router = useRouter();
  const [decision, setDecision] = useState<PlanPurchaseDecisionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [walletId, setWalletId] = useState<string>(plan.wallet_id ?? "");
  // Actual price paid — defaults to the expected price the user planned
  // for. Migration 0088 added bought_actual_price specifically so the
  // expected-vs-actual delta is captured (drives the satisfaction loop
  // and price-lookup feedback). An editable input here is the only way
  // the column ever sees a real value.
  const expectedAmount = Number(plan.expected_amount ?? 0);
  const [actualAmount, setActualAmount] = useState<string>(
    expectedAmount > 0 ? String(expectedAmount) : "",
  );
  const expectedCurrency = (plan.expected_currency ?? baseCurrency) as CurrencyCode;
  const [confirmPending, startConfirm] = useTransition();

  useEffect(() => {
    if (!open) return;
    setDecision(null);
    setLoading(true);
    void (async () => {
      try {
        const res = await runDecisionSupport(plan.id);
        if (res.ok) setDecision(res.data);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, plan.id]);

  const confirm = () => {
    if (!walletId) {
      toast.error("Pick a wallet to confirm.");
      return;
    }
    const actualN = actualAmount.trim() === "" ? expectedAmount : Number(actualAmount);
    if (!Number.isFinite(actualN) || actualN < 0) {
      toast.error("Actual price must be 0 or greater.");
      return;
    }
    startConfirm(async () => {
      const res = await confirmPlanBought(plan.id, {
        wallet_id: walletId,
        amount: actualN,
        currency: expectedCurrency,
      });
      if (!res.ok) {
        toast.error(res.error || "Couldn't confirm.");
        return;
      }
      toast.success(`Bought ${plan.label}`);
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <CenterModal
      open={open}
      onOpenChange={onOpenChange}
      title={`Mark as bought · ${plan.label}`}
      description={
        decision?.headline ||
        "Quick soft check before confirming. You can confirm anyway."
      }
      size="md"
    >
      <CenterModalBody>
        <div className="grid gap-3">
          {loading && (
            <div className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
              Reading the situation...
            </div>
          )}
          {decision && (
            <>
              <section className="flex flex-col gap-1.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Wallet impact
                </div>
                <ul className="rounded-[10px] border border-border/50 bg-card/40 divide-y divide-border/40">
                  {decision.wallet_impact_rows.map((row, i) => (
                    <li
                      key={i}
                      className="flex items-baseline justify-between px-3 py-2"
                    >
                      <span className="text-sm capitalize text-foreground/80">
                        {row.source}
                      </span>
                      <span
                        className={
                          "font-display tabular text-sm " +
                          (row.negative_flag ? "text-overdue" : "")
                        }
                      >
                        {formatMoney(row.before, baseCurrency, { compact: true })} →{" "}
                        {formatMoney(row.after, baseCurrency, { compact: true })}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
              {decision.period_impact_note && (
                <p className="text-[11.5px] leading-snug text-muted-foreground">
                  Period impact: {decision.period_impact_note}
                </p>
              )}
              {decision.pack_rhythm_fit && (
                <p className="text-[11.5px] leading-snug text-muted-foreground">
                  Pack rhythm: {decision.pack_rhythm_fit}
                </p>
              )}
              {decision.alternatives.length > 0 && (
                <section className="flex flex-col gap-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Or pull from
                  </div>
                  <ul className="text-[11.5px] leading-snug text-muted-foreground">
                    {decision.alternatives.map((alt, i) => (
                      <li key={i}>· {alt}</li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          <section className="flex flex-col gap-1.5 border-t border-border/40 pt-3">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Actual price paid ({expectedCurrency})
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              step="1"
              value={actualAmount}
              onChange={(e) => setActualAmount(e.target.value)}
              placeholder={expectedAmount > 0 ? String(expectedAmount) : "0"}
              className="h-9 text-right tabular text-sm"
            />
            <div className="text-[10.5px] text-muted-foreground">
              Estimated {formatMoney(expectedAmount, expectedCurrency, { compact: true })} — edit to match the actual receipt.
            </div>
          </section>

          <section className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Wallet to spend from
            </Label>
            <Select
              items={wallets.map((w) => ({ value: w.id, label: w.name }))}
              value={walletId || undefined}
              onValueChange={(v) => v && setWalletId(v)}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Pick a wallet" />
              </SelectTrigger>
              <SelectContent>
                {wallets.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>
        </div>
      </CenterModalBody>
      <CenterModalFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={confirm} disabled={confirmPending || !walletId}>
          {confirmPending ? "Saving..." : "Confirm bought"}
        </Button>
      </CenterModalFooter>
    </CenterModal>
  );
}
