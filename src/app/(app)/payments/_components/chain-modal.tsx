"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowRight, Plus, Trash2 } from "lucide-react";
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
  addPaymentWithChain,
  consolidateClientMemoryAction,
  refreshRatesIfStale,
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

type Step = {
  from_method_id: string | null; // source the money came from
  method_id: string | null; // destination it landed on
  amount_in: string;
  currency_in: string;
  amount_out: string;
  currency_out: string;
};

export function ChainModal({
  open,
  onOpenChange,
  projects,
  methods,
  balances,
  currencies,
  rates,
  baseCurrency,
  defaultProjectId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projects: ProjectOpt[];
  methods: { id: string; name: string }[];
  balances: Map<string, number>;
  currencies: string[];
  rates: Rate[];
  baseCurrency: CurrencyCode;
  defaultProjectId?: string;
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState<string>("");
  const [paidAt, setPaidAt] = useState(() =>
    phtToday(),
  );
  const [steps, setSteps] = useState<Step[]>([]);
  const [pending, start] = useTransition();

  // Reset when opened. Nothing is preselected — the user picks the project and
  // method themselves. The ONLY exception is a deep-link from the kanban
  // (dragging a card to Paid), where the project is known: then we select it
  // and prefill its outstanding amount. Always pull fresh FX for the preview.
  useEffect(() => {
    if (!open) return;
    const deepLinked = defaultProjectId
      ? projects.find((x) => x.id === defaultProjectId)
      : undefined;
    setProjectId(deepLinked?.id ?? "");
    setPaidAt(phtToday());
    setSteps([
      {
        from_method_id: null,
        method_id: null,
        amount_in:
          deepLinked && deepLinked.outstanding > 0
            ? String(deepLinked.outstanding)
            : "",
        currency_in: deepLinked?.currency ?? baseCurrency,
        amount_out: "",
        currency_out: baseCurrency,
      },
    ]);
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

  const preview = useMemo(() => {
    if (!steps.length) return { net: 0, gross: 0, fee: 0, pct: 0 };
    const first = steps[0];
    const final = steps[steps.length - 1];
    const gross = toBase(Number(first.amount_in || 0), first.currency_in);
    const net = toBase(Number(final.amount_out || 0), final.currency_out);
    const fee = Math.max(0, gross - net);
    return { net, gross, fee, pct: gross > 0 ? fee / gross : 0 };
  }, [steps]); // eslint-disable-line react-hooks/exhaustive-deps

  function setStep(i: number, patch: Partial<Step>) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function addStep() {
    setSteps((prev) => {
      const last = prev[prev.length - 1];
      return [
        ...prev,
        {
          // The previous hop's destination is this hop's source.
          from_method_id: last?.method_id ?? null,
          method_id: null,
          amount_in: last?.amount_out ?? "",
          currency_in: last?.currency_out ?? baseCurrency,
          amount_out: "",
          currency_out: baseCurrency,
        },
      ];
    });
  }
  function removeStep(i: number) {
    setSteps((prev) =>
      prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i),
    );
  }

  function onProjectChange(id: string) {
    setProjectId(id);
    const p = projects.find((x) => x.id === id);
    if (p)
      setStep(0, {
        currency_in: p.currency,
        amount_in: p.outstanding > 0 ? String(p.outstanding) : "",
      });
  }

  function save() {
    if (!projectId) {
      toast.error("Pick a project first.");
      return;
    }
    const parsed = steps.map((s) => ({
      from_method_id: s.from_method_id,
      method_id: s.method_id,
      amount_in: Number(s.amount_in),
      currency_in: s.currency_in,
      amount_out: Number(s.amount_out),
      currency_out: s.currency_out,
    }));
    if (
      parsed.some(
        (s) =>
          !s.amount_in || !s.amount_out || s.amount_in <= 0 || s.amount_out <= 0,
      )
    ) {
      toast.error("Every step needs an amount in and out.");
      return;
    }
    start(async () => {
      try {
        const res = await addPaymentWithChain({
          project_id: projectId,
          paid_at: paidAt,
          steps: parsed,
        });
        playLanded();
        toast.success(`Logged · ${formatMoney(preview.net, baseCurrency)} landed`);
        onOpenChange(false);
        router.refresh();
        // Let the client's AI memory learn from this new transaction (out-of-band).
        if (res?.clientId)
          consolidateClientMemoryAction(res.clientId)
            .then(() => router.refresh())
            .catch(() => {});
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
      className="sm:max-w-[560px]"
      title="Log a payment"
      description="Record the chain the money took to reach you. Each step's fee is what goes in minus what comes out."
    >
      <CenterModalBody>
        <div className="grid gap-4 pt-1">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Project">
              <Select
                items={projects.map((p) => ({
                  value: p.id,
                  label: `${p.title}${p.clientName ? ` · ${p.clientName}` : ""}`,
                }))}
                value={projectId}
                onValueChange={(v) => v && onProjectChange(v)}
              >
                <SelectTrigger className="w-full">
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
            </Field>
            <Field label="Date landed">
              <Input
                type="date"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
              />
            </Field>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                The chain
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={addStep}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add step
              </Button>
            </div>

            <div className="space-y-1.5">
              <AnimatePresence initial={false}>
                {steps.map((s, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{
                      duration: 0.2,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    className="rounded-[10px] border border-border/60 bg-muted/25 px-2.5 py-2"
                  >
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="inline-flex size-4 items-center justify-center rounded-full bg-foreground/10 font-mono text-[10px]">
                        {i + 1}
                      </span>
                      {steps.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeStep(i)}
                          className="grid size-6 place-items-center text-muted-foreground/50 hover:text-destructive"
                          aria-label="Remove step"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="mb-1.5 grid grid-cols-[1fr_auto_1fr] items-end gap-1.5">
                      <MethodPicker
                        label="From"
                        methods={methods}
                        balances={balances}
                        baseCurrency={baseCurrency}
                        value={s.from_method_id}
                        onChange={(v) => setStep(i, { from_method_id: v })}
                      />
                      <ArrowRight className="mb-2 h-3.5 w-3.5 text-muted-foreground/50" />
                      <MethodPicker
                        label="To"
                        methods={methods}
                        balances={balances}
                        baseCurrency={baseCurrency}
                        value={s.method_id}
                        onChange={(v) => setStep(i, { method_id: v })}
                      />
                    </div>
                    <AmountCurrency
                      amount={s.amount_in}
                      currency={s.currency_in}
                      currencies={currencies}
                      onAmount={(v) => setStep(i, { amount_in: v })}
                      onCurrency={(v) => setStep(i, { currency_in: v })}
                      label="In"
                    />
                    <div className="my-0.5 flex justify-center text-muted-foreground/50">
                      <ArrowDown className="h-3 w-3" />
                    </div>
                    <AmountCurrency
                      amount={s.amount_out}
                      currency={s.currency_out}
                      currencies={currencies}
                      onAmount={(v) => setStep(i, { amount_out: v })}
                      onCurrency={(v) => setStep(i, { currency_out: v })}
                      label="Out"
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          <div className="rounded-[10px] border border-[var(--success)]/40 bg-card px-3 py-2.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Net landed
              </span>
              <span className="text-xl font-semibold tabular">
                {formatMoney(preview.net, baseCurrency)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground tabular">
              <span>
                Gross{" "}
                {formatMoney(preview.gross, baseCurrency, { compact: true })}
              </span>
              <span className={preview.pct > 0 ? "text-[var(--overdue)]" : ""}>
                fee{" "}
                {formatMoney(preview.fee, baseCurrency, { compact: true })} (
                {(preview.pct * 100).toFixed(1)}%)
              </span>
            </div>
          </div>
        </div>
      </CenterModalBody>

      <CenterModalFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Log payment"}
        </Button>
      </CenterModalFooter>
    </CenterModal>
  );
}

function MethodPicker({
  label,
  methods,
  balances,
  baseCurrency,
  value,
  onChange,
}: {
  label: string;
  methods: { id: string; name: string }[];
  balances: Map<string, number>;
  baseCurrency: CurrencyCode;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      <WalletPickerWithBalance
        size="sm"
        value={value ?? ""}
        onValueChange={(v) => onChange(v || null)}
        methods={methods}
        balances={balances}
        baseCurrency={baseCurrency}
        placeholder={label === "From" ? "Source" : "Where it landed"}
        triggerClassName="h-8 text-xs"
      />
    </div>
  );
}

function AmountCurrency({
  amount,
  currency,
  currencies,
  onAmount,
  onCurrency,
  label,
}: {
  amount: string;
  currency: string;
  currencies: string[];
  onAmount: (v: string) => void;
  onCurrency: (v: string) => void;
  label: string;
}) {
  return (
    <div className="flex w-full items-center gap-1.5">
      <span className="w-6 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <Input
        type="number"
        inputMode="decimal"
        step="0.01"
        placeholder="0.00"
        value={amount}
        onChange={(e) => onAmount(e.target.value)}
        className="h-8 flex-1 text-right text-sm tabular"
      />
      <Select
        items={currencies.map((c) => ({ value: c, label: c }))}
        value={currency}
        onValueChange={(v) => v && onCurrency(v)}
      >
        <SelectTrigger className="h-8 w-[78px] shrink-0 text-xs">
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
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
