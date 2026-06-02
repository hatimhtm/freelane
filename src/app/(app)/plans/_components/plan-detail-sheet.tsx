"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  CenterModal,
  CenterModalBody,
  CenterModalFooter,
} from "@/components/ui/center-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

import {
  abandonPlan,
  updatePlanJustification,
  updatePlanPrice,
  updatePlanTargetDate,
} from "@/app/(app)/plans/_actions/plan-actions";
import { deletePlannedSpend, updatePlannedSpend } from "@/lib/data/actions";
import { StrategyOptions } from "./strategy-options";
import { PurchaseDecisionModal } from "./purchase-decision-modal";
import { formatMoney } from "@/lib/money";
import type {
  CurrencyCode,
  PlannedSpend,
  PlanStrategy,
} from "@/lib/supabase/types";
import type { WalletOpt } from "@/app/(app)/spending/_components/spend-modal";

// Plan detail sheet — opens when the user taps a plan card.
//
// Surfaces: editable name / price / target date / justification, the
// 2-3 ranked strategy options, "Mark as bought" → decision support.
// Justification visible HERE only (never on the card).

export function PlanDetailSheet({
  open,
  onOpenChange,
  plan,
  strategies,
  wallets,
  baseCurrency,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  plan: PlannedSpend;
  strategies: PlanStrategy[];
  wallets: WalletOpt[];
  baseCurrency: CurrencyCode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [decisionOpen, setDecisionOpen] = useState(false);

  // Local edit state — saves on blur / explicit save buttons so the user
  // can type freely without race-condition flicker.
  const [name, setName] = useState(plan.label);
  const [price, setPrice] = useState(
    plan.expected_amount > 0 ? String(plan.expected_amount) : "",
  );
  const [targetDate, setTargetDate] = useState(plan.target_date ?? "");
  const [justification, setJustification] = useState(plan.justification ?? "");

  const saveName = () => {
    if (name.trim() === plan.label) return;
    start(async () => {
      try {
        await updatePlannedSpend(plan.id, { label: name.trim() });
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  };
  const savePrice = () => {
    // Empty input must NOT collapse to 0 on blur — the previous
    // behaviour sent 0 to updatePlanPrice, which used to throw and
    // showed a generic "Couldn't save price." toast. An emptied price
    // means "no change" here; users who actually want to re-ask the AI
    // tap the explicit Propose button on the strategy card.
    if (price.trim() === "") return;
    const n = Number(price);
    if (!Number.isFinite(n) || n === plan.expected_amount) return;
    if (n < 0) {
      toast.error("Price must be 0 or greater.");
      return;
    }
    start(async () => {
      const res = await updatePlanPrice(plan.id, n);
      if (!res.ok) {
        toast.error(res.error || "Couldn't save price.");
        return;
      }
      router.refresh();
    });
  };
  const saveTargetDate = () => {
    if ((targetDate || null) === plan.target_date) return;
    start(async () => {
      const res = await updatePlanTargetDate(plan.id, targetDate || null);
      if (!res.ok) {
        toast.error(res.error || "Couldn't save target date.");
        return;
      }
      router.refresh();
    });
  };
  const saveJustification = () => {
    if ((justification.trim() || null) === plan.justification) return;
    start(async () => {
      const res = await updatePlanJustification(
        plan.id,
        justification.trim() || null,
      );
      if (!res.ok) {
        toast.error(res.error || "Couldn't save.");
        return;
      }
      router.refresh();
    });
  };

  const abandon = () => {
    start(async () => {
      const res = await abandonPlan(plan.id);
      if (!res.ok) {
        toast.error(res.error || "Couldn't abandon.");
        return;
      }
      toast.success(`Abandoned ${plan.label}`);
      onOpenChange(false);
      router.refresh();
    });
  };

  // Plans redesign collapses the user-facing terminate path to a
  // single "Abandon" — cancelPlannedSpend is still reachable from
  // back-compat code paths but no longer exposed on the redesigned UI.
  const remove = () => {
    start(async () => {
      try {
        await deletePlannedSpend(plan.id);
        toast.success(`Deleted ${plan.label}`);
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  };

  const isHistory =
    plan.status === "bought" ||
    plan.status === "done" ||
    plan.status === "cancelled" ||
    plan.status === "abandoned";

  return (
    <>
      <CenterModal
        open={open}
        onOpenChange={onOpenChange}
        title={plan.label}
        description={
          isHistory
            ? `History · ${plan.status}`
            : "Tap a strategy to activate. Edit anything anytime."
        }
        size="lg"
      >
        <CenterModalBody>
          <div className="flex flex-col gap-4">
            <section className="grid gap-3">
              <Field label="Name">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={saveName}
                  className="h-9 text-sm"
                  disabled={isHistory}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label={`Price (${baseCurrency})`}>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    onBlur={savePrice}
                    className="h-9 text-right tabular text-sm"
                    disabled={isHistory}
                  />
                  {plan.ai_price_range_high && plan.ai_price_range_low && (
                    <div className="mt-1.5 text-[11px] text-muted-foreground">
                      AI range:{" "}
                      {formatMoney(
                        Number(plan.ai_price_range_low),
                        baseCurrency,
                        { compact: true },
                      )}
                      –
                      {formatMoney(
                        Number(plan.ai_price_range_high),
                        baseCurrency,
                        { compact: true },
                      )}
                      {plan.ai_price_sources?.length
                        ? ` · ${plan.ai_price_sources.join(", ")}`
                        : ""}
                    </div>
                  )}
                </Field>

                <Field label="Target date" optional>
                  <Input
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    onBlur={saveTargetDate}
                    className="h-9 tabular text-sm"
                    disabled={isHistory}
                  />
                </Field>
              </div>

              <Field label="Why I want this" optional>
                <Textarea
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  onBlur={saveJustification}
                  rows={3}
                  className="resize-none text-sm"
                  disabled={isHistory}
                />
              </Field>
            </section>

            {!isHistory && (
              <StrategyOptions
                planId={plan.id}
                strategies={strategies}
                baseCurrency={baseCurrency}
              />
            )}

            {isHistory && (
              <section className="rounded-[10px] border border-border/50 bg-card/40 p-3 text-[11.5px] leading-snug text-muted-foreground">
                {plan.bought_at && (
                  <div>
                    Bought{" "}
                    <span className="text-foreground/80">{plan.bought_at}</span>
                    {plan.bought_actual_price !== null && (
                      <>
                        {" · "}
                        <span className="tabular text-foreground/80">
                          {formatMoney(
                            Number(plan.bought_actual_price),
                            baseCurrency,
                            { compact: true },
                          )}
                        </span>
                      </>
                    )}
                  </div>
                )}
                {plan.satisfaction_rating !== null && (
                  <div>Satisfaction: {"★".repeat(plan.satisfaction_rating)}</div>
                )}
                {plan.satisfaction_note && (
                  <div className="mt-1.5 whitespace-pre-wrap text-foreground/75">
                    {plan.satisfaction_note}
                  </div>
                )}
              </section>
            )}
          </div>
        </CenterModalBody>
        <CenterModalFooter>
          {isHistory ? (
            <>
              <Button variant="ghost" onClick={remove} disabled={pending}>
                Delete from history
              </Button>
              <Button onClick={() => onOpenChange(false)}>Close</Button>
            </>
          ) : (
            <>
              <div className="mr-auto flex gap-2">
                <Button
                  variant="ghost"
                  onClick={abandon}
                  disabled={pending}
                >
                  Abandon
                </Button>
              </div>
              <Button onClick={() => setDecisionOpen(true)} disabled={pending}>
                Mark as bought
              </Button>
            </>
          )}
        </CenterModalFooter>
      </CenterModal>

      <PurchaseDecisionModal
        open={decisionOpen}
        onOpenChange={setDecisionOpen}
        plan={plan}
        wallets={wallets}
        baseCurrency={baseCurrency}
      />
    </>
  );
}

function Field({
  label,
  optional,
  children,
}: {
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
        {optional && (
          <span className="ml-1 normal-case tracking-normal text-muted-foreground/60">
            optional
          </span>
        )}
      </Label>
      {children}
    </div>
  );
}
