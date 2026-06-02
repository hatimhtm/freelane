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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

import { createPlannedSpend, updatePlannedSpend } from "@/lib/data/actions";
import { requestAiPriceLookup } from "@/app/(app)/plans/_actions/plan-actions";
import { cn, phtToday } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode, PlannedSpend } from "@/lib/supabase/types";

// Plans redesign (2026-06) — narrowed plan modal. Four fields only:
//   1. Name
//   2. Price (auto from AI when blank — clickable edit chip with
//      range + sources + confidence)
//   3. Target date (optional)
//   4. Why I want this (optional, freeform justification)
//
// Wallet picker, certainty toggle, big-plan switch, category toggles,
// ±window — all REMOVED. The detail sheet handles edit anytime; the
// AI price lookup runs on first save when price is blank.

export function PlanModal({
  open,
  onOpenChange,
  editing,
  baseCurrency,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: PlannedSpend | null;
  baseCurrency: CurrencyCode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [targetDate, setTargetDate] = useState<string>("");
  const [justification, setJustification] = useState("");
  // AI estimate snapshot — populated after requestAiPriceLookup runs on
  // save. Persists in the modal so the user can see "range / sources /
  // confidence" right after the plan is created without re-opening.
  const [aiHint, setAiHint] = useState<{
    range_low: number;
    range_high: number;
    sources: string[];
    confidence: number;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.label);
      setPrice(
        editing.expected_amount > 0 ? String(editing.expected_amount) : "",
      );
      setTargetDate(editing.target_date ?? "");
      setJustification(editing.justification ?? "");
      if (editing.ai_price_range_high && editing.ai_price_range_low) {
        setAiHint({
          range_low: Number(editing.ai_price_range_low),
          range_high: Number(editing.ai_price_range_high),
          sources: editing.ai_price_sources ?? [],
          confidence: 0.7,
        });
      } else {
        setAiHint(null);
      }
    } else {
      setName("");
      setPrice("");
      setTargetDate("");
      setJustification("");
      setAiHint(null);
    }
    setError(null);
  }, [open, editing]);

  function save() {
    setError(null);
    if (!name.trim()) {
      setError("Give it a name.");
      return;
    }
    const priceN = price.trim() === "" ? 0 : Number(price);
    if (!(priceN >= 0)) {
      setError("Price must be 0 or greater.");
      return;
    }
    start(async () => {
      try {
        let planId = editing?.id ?? null;
        const wantAiPrice = priceN === 0;
        if (editing) {
          // planned_for (spend-date estimate) and target_date ("by
          // when") are distinct concepts (migration 0088). The edit
          // path leaves planned_for untouched — it's only set on
          // create. price_source only flips when the price input
          // actually changed; editing only the target_date or
          // justification preserves the audit trail.
          const priceChanged = priceN !== Number(editing.expected_amount ?? 0);
          const editPatch: Parameters<typeof updatePlannedSpend>[1] = {
            label: name.trim(),
            expected_amount: priceN,
            expected_currency: baseCurrency,
            target_date: targetDate || null,
            justification: justification.trim() || null,
          };
          if (priceChanged) {
            editPatch.price_source = wantAiPrice ? "ai" : "adjusted";
          }
          await updatePlannedSpend(editing.id, editPatch);
        } else {
          const result = await createPlannedSpend({
            label: name.trim(),
            expected_amount: priceN,
            expected_currency: baseCurrency,
            // planned_for is the "estimated spend date" and target_date
            // is "by when I want it" — distinct concepts per migration
            // 0088. Previously planned_for fell back to target_date,
            // which conflated them and pushed the plan's full price
            // into a multi-month projection horizon even though the
            // user hadn't committed to spending it that far out. Anchor
            // planned_for at today; target_date carries the aspiration.
            planned_for: phtToday(),
            target_date: targetDate || null,
            justification: justification.trim() || null,
            price_source: "user",
          });
          if (!result.ok) {
            setError(result.error || "Couldn't save the plan.");
            return;
          }
          planId = result.data.id;
        }
        // If price was empty, kick off the AI lookup AFTER the plan
        // exists (requestAiPriceLookup needs a real plan_id).
        if (wantAiPrice && planId) {
          const lookup = await requestAiPriceLookup(planId);
          if (lookup.ok && lookup.data.range_high > 0) {
            setAiHint(lookup.data);
          }
        }
        toast.success(editing ? `Updated ${name}` : `Planned ${name}`);
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  const confidenceLabel =
    aiHint == null
      ? null
      : aiHint.confidence >= 0.85
        ? "high confidence"
        : aiHint.confidence >= 0.5
          ? "rough range"
          : "low confidence";

  return (
    <CenterModal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit plan" : "New plan"}
      description={
        editing
          ? "Edit anything anytime."
          : "Big purchases the runway should know about."
      }
      size="md"
    >
      <CenterModalBody>
        {error && (
          <div className="mb-3 border-l-2 border-[var(--overdue,#b65b3c)] bg-muted/30 px-3 py-2 text-xs leading-relaxed text-foreground/80">
            {error}
          </div>
        )}
        <div className="grid gap-3">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="MacBook M3 Pro, Apple Dev renewal, …"
              className="h-9 text-sm"
            />
          </Field>

          <Field label={`Price (${baseCurrency})`}>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                step="1"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="Leave blank — AI will estimate"
                className={cn(
                  "h-9 flex-1 text-right tabular text-sm",
                  aiHint && price === "" && "italic text-muted-foreground",
                )}
              />
            </div>
            {aiHint && aiHint.range_high > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>
                  range:{" "}
                  <span className="tabular text-foreground/80">
                    {formatMoney(aiHint.range_low, baseCurrency, { compact: true })}–
                    {formatMoney(aiHint.range_high, baseCurrency, { compact: true })}
                  </span>
                </span>
                {aiHint.sources.length > 0 && (
                  <span>· sources: {aiHint.sources.join(", ")}</span>
                )}
                {confidenceLabel && <span>· {confidenceLabel}</span>}
              </div>
            )}
          </Field>

          <Field label="Target date" optional>
            <Input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="h-9 tabular text-sm"
            />
          </Field>

          <Field label="Why I want this" optional>
            <Textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="The reason in your own words — the AI references this later."
              rows={3}
              className="resize-none text-sm"
            />
          </Field>
        </div>
      </CenterModalBody>
      <CenterModalFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={save} disabled={pending || !name.trim()}>
          {pending ? "Saving..." : editing ? "Update plan" : "Save plan"}
        </Button>
      </CenterModalFooter>
    </CenterModal>
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
