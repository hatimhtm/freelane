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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WalletPickerWithBalance } from "@/components/app/wallet-picker";

import { createPlannedSpend, updatePlannedSpend } from "@/lib/data/actions";
import { cn } from "@/lib/utils";
import type {
  CurrencyCode,
  PlannedSpend,
  PlannedSpendCertainty,
  SpendCategory,
} from "@/lib/supabase/types";
import type { WalletOpt } from "@/app/(app)/spending/_components/spend-modal";

const CERTAINTIES: PlannedSpendCertainty[] = ["firm", "probable", "maybe"];

export function PlanModal({
  open,
  onOpenChange,
  editing,
  wallets,
  currencies,
  baseCurrency,
  categories,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: PlannedSpend | null;
  wallets: WalletOpt[];
  currencies: string[];
  baseCurrency: CurrencyCode;
  categories: SpendCategory[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(baseCurrency);
  const [plannedFor, setPlannedFor] = useState(() => isoToday());
  const [windowDays, setWindowDays] = useState("0");
  const [certainty, setCertainty] = useState<PlannedSpendCertainty>("firm");
  const [walletId, setWalletId] = useState<string>("");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [isBigPlan, setIsBigPlan] = useState(false);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setLabel(editing.label);
      setAmount(String(editing.expected_amount));
      setCurrency(editing.expected_currency as CurrencyCode);
      setPlannedFor(editing.planned_for);
      setWindowDays(String(editing.planned_for_window_days));
      setCertainty(editing.certainty);
      setWalletId(editing.wallet_id ?? "");
      setCategoryIds(editing.default_category_ids ?? []);
      setIsBigPlan(editing.is_big_plan);
      setNotes(editing.notes ?? "");
    } else {
      setLabel("");
      setAmount("");
      setCurrency(baseCurrency);
      setPlannedFor(isoToday());
      setWindowDays("0");
      setCertainty("firm");
      setWalletId("");
      setCategoryIds([]);
      setIsBigPlan(false);
      setNotes("");
    }
    setError(null);
  }, [open, editing, baseCurrency]);

  const balancesByMethod = new Map<string, number>();
  for (const w of wallets) {
    if (typeof w.balanceBase === "number") balancesByMethod.set(w.id, w.balanceBase);
  }

  function toggleCategory(id: string) {
    setCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function save() {
    setError(null);
    if (!label.trim()) {
      setError("Give the plan a label.");
      return;
    }
    const amt = Number(amount);
    if (!(amt > 0)) {
      setError("Enter an amount.");
      return;
    }
    const winDays = Math.max(0, Math.floor(Number(windowDays) || 0));
    start(async () => {
      try {
        if (editing) {
          await updatePlannedSpend(editing.id, {
            label: label.trim(),
            expected_amount: amt,
            expected_currency: currency,
            planned_for: plannedFor,
            planned_for_window_days: winDays,
            certainty,
            wallet_id: walletId || null,
            default_category_ids: categoryIds,
            is_big_plan: isBigPlan,
            notes: notes.trim() || null,
          });
          toast.success(`Updated · ${label}`);
        } else {
          await createPlannedSpend({
            label: label.trim(),
            expected_amount: amt,
            expected_currency: currency,
            planned_for: plannedFor,
            planned_for_window_days: winDays,
            certainty,
            wallet_id: walletId || null,
            default_category_ids: categoryIds,
            is_big_plan: isBigPlan,
            notes: notes.trim() || null,
          });
          toast.success(`Planned · ${label}`);
        }
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <CenterModal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit plan" : "Plan a future spend"}
      description={editing ? "Update the intent." : "Tell the math what's coming."}
      size="md"
    >
      <CenterModalBody>
        {error && (
          <div className="mb-3 border-l-2 border-[var(--overdue,#b65b3c)] bg-muted/30 px-3 py-2 text-xs leading-relaxed text-foreground/80">
            {error}
          </div>
        )}
        <div className="grid gap-3">
          <Field label="Label">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="MacBook M3 Pro, Apple Dev renewal, Eid envelope"
              className="h-9 text-sm"
            />
          </Field>

          <div className="grid grid-cols-[1fr_120px] gap-3">
            <Field label="Amount">
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="h-9 flex-1 text-right tabular text-sm"
                />
                <Select
                  items={currencies.map((c) => ({ value: c, label: c }))}
                  value={currency}
                  onValueChange={(v) => v && setCurrency(v as CurrencyCode)}
                >
                  <SelectTrigger className="h-9 w-[78px] shrink-0 text-xs">
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
            </Field>
            <Field label="Date">
              <Input
                type="date"
                value={plannedFor}
                onChange={(e) => setPlannedFor(e.target.value)}
                className="h-9 tabular text-sm"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Window ±days">
              <Input
                type="number"
                inputMode="numeric"
                value={windowDays}
                onChange={(e) => setWindowDays(e.target.value)}
                className="h-9 text-right tabular text-sm"
              />
            </Field>
            <Field label="Certainty">
              <div className="flex flex-wrap gap-1">
                {CERTAINTIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCertainty(c)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs font-medium",
                      certainty === c
                        ? "border-foreground bg-foreground text-background"
                        : "border-border/70 text-foreground/80 hover:bg-muted",
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <Field label="Wallet (optional)">
            <WalletPickerWithBalance
              value={walletId || undefined}
              onValueChange={setWalletId}
              methods={wallets.map((w) => ({ id: w.id, name: w.name }))}
              balances={balancesByMethod}
              baseCurrency={baseCurrency}
              placeholder="Where you'll spend from"
              includeNone
            />
          </Field>

          <Field label="Tags">
            <div className="flex flex-wrap gap-1.5">
              {categories.filter((c) => !c.archived).map((c) => {
                const on = categoryIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCategory(c.id)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs font-medium",
                      on
                        ? "border-foreground bg-foreground text-background"
                        : "border-border/70 text-foreground/80 hover:bg-muted",
                    )}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </Field>

          <div className="flex items-center justify-between gap-3 border-t border-border/40 pt-2">
            <span className="text-xs font-medium">
              Big plan — surface Pre-Mortem
            </span>
            <Switch checked={isBigPlan} onCheckedChange={setIsBigPlan} />
          </div>

          <Field label="Notes" optional>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why this, what tied to it, what could shift"
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
        <Button onClick={save} disabled={pending || !label.trim() || !amount}>
          {pending ? "Saving…" : editing ? "Update plan" : "Save plan"}
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

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
