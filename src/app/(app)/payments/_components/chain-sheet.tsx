"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { formatMoney } from "@/lib/money";
import { playLanded } from "@/lib/sound";
import { addPaymentWithChain, refreshRatesIfStale } from "@/lib/data/actions";
import type { CurrencyCode } from "@/lib/supabase/types";

type ProjectOpt = { id: string; title: string; currency: CurrencyCode; clientName: string; outstanding: number };
type Rate = { code: string; rate_to_base: number };

type Step = {
  method_id: string | null;
  amount_in: string;
  currency_in: string;
  amount_out: string;
  currency_out: string;
};

export function ChainSheet({
  open,
  onOpenChange,
  projects,
  methods,
  currencies,
  rates,
  baseCurrency,
  defaultProjectId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projects: ProjectOpt[];
  methods: { id: string; name: string }[];
  currencies: string[];
  rates: Rate[];
  baseCurrency: CurrencyCode;
  defaultProjectId?: string;
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState<string>("");
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [steps, setSteps] = useState<Step[]>([]);
  const [pending, start] = useTransition();

  const project = projects.find((p) => p.id === projectId);

  // Reset when opened: select the deep-linked project (or the first), one step
  // pre-filled with its outstanding amount in its own currency → out in base.
  // Also pull fresh FX so the preview values the payment at today's rate.
  useEffect(() => {
    if (!open) return;
    const p = projects.find((x) => x.id === defaultProjectId) ?? projects[0];
    setProjectId(p?.id ?? "");
    setPaidAt(new Date().toISOString().slice(0, 10));
    setSteps([
      {
        method_id: methods[0]?.id ?? null,
        amount_in: p && p.outstanding > 0 ? String(p.outstanding) : "",
        currency_in: p?.currency ?? baseCurrency,
        amount_out: "",
        currency_out: baseCurrency,
      },
    ]);
    refreshRatesIfStale(6).then((r) => { if (r.refreshed) router.refresh(); }).catch(() => {});
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
          method_id: methods[0]?.id ?? null,
          amount_in: last?.amount_out ?? "",
          currency_in: last?.currency_out ?? baseCurrency,
          amount_out: "",
          currency_out: baseCurrency,
        },
      ];
    });
  }
  function removeStep(i: number) {
    setSteps((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  function onProjectChange(id: string) {
    setProjectId(id);
    const p = projects.find((x) => x.id === id);
    if (p) setStep(0, { currency_in: p.currency, amount_in: p.outstanding > 0 ? String(p.outstanding) : "" });
  }

  function save() {
    if (!projectId) { toast.error("Pick a project first."); return; }
    const parsed = steps.map((s) => ({
      method_id: s.method_id,
      amount_in: Number(s.amount_in),
      currency_in: s.currency_in,
      amount_out: Number(s.amount_out),
      currency_out: s.currency_out,
    }));
    if (parsed.some((s) => !s.amount_in || !s.amount_out || s.amount_in <= 0 || s.amount_out <= 0)) {
      toast.error("Every step needs an amount in and out.");
      return;
    }
    start(async () => {
      try {
        await addPaymentWithChain({ project_id: projectId, paid_at: paidAt, steps: parsed });
        playLanded();
        toast.success(`Logged · ${formatMoney(preview.net, baseCurrency)} landed`);
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto scroll-muted sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Log a payment</SheetTitle>
          <SheetDescription>
            Record the chain the money took to reach you. Each step&apos;s fee is computed from what goes in vs what comes out.
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-5 px-4 py-6">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Project">
              <Select
                items={projects.map((p) => ({ value: p.id, label: `${p.title}${p.clientName ? ` · ${p.clientName}` : ""}` }))}
                value={projectId}
                onValueChange={(v) => v && onProjectChange(v)}
              >
                <SelectTrigger className="w-full"><SelectValue placeholder="Pick a project" /></SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.title}{p.clientName ? ` · ${p.clientName}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Date landed">
              <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </Field>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-xs font-medium text-muted-foreground">The chain</Label>
              <Button type="button" variant="ghost" size="sm" onClick={addStep}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add step
              </Button>
            </div>

            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {steps.map((s, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    className="rounded-xl border border-border/60 bg-muted/30 p-3"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="inline-flex size-5 items-center justify-center rounded-full bg-foreground/10 font-mono text-[10px]">{i + 1}</span>
                      <div className="flex-1 px-2">
                        <Select
                          items={methods.map((m) => ({ value: m.id, label: m.name }))}
                          value={s.method_id ?? ""}
                          onValueChange={(v) => setStep(i, { method_id: v || null })}
                        >
                          <SelectTrigger className="h-10 sm:h-8 w-full text-xs"><SelectValue placeholder="Method" /></SelectTrigger>
                          <SelectContent>
                            {methods.map((m) => (<SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      </div>
                      {steps.length > 1 && (
                        <button type="button" onClick={() => removeStep(i)} className="grid size-9 sm:size-7 place-items-center text-muted-foreground/50 hover:text-destructive" aria-label="Remove step">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                      <AmountCurrency
                        amount={s.amount_in}
                        currency={s.currency_in}
                        currencies={currencies}
                        onAmount={(v) => setStep(i, { amount_in: v })}
                        onCurrency={(v) => setStep(i, { currency_in: v })}
                        label="In"
                      />
                    </div>
                    <div className="my-1 flex justify-center text-muted-foreground/50"><ArrowDown className="h-3 w-3" /></div>
                    <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                      <AmountCurrency
                        amount={s.amount_out}
                        currency={s.currency_out}
                        currencies={currencies}
                        onAmount={(v) => setStep(i, { amount_out: v })}
                        onCurrency={(v) => setStep(i, { currency_out: v })}
                        label="Out"
                      />
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--success)]/40 bg-card p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Net landed</span>
              <span className="text-2xl font-semibold tabular">{formatMoney(preview.net, baseCurrency)}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground tabular">
              <span>Gross (today&apos;s rate) {formatMoney(preview.gross, baseCurrency, { compact: true })}</span>
              <span className={preview.pct > 0 ? "text-[var(--overdue)]" : ""}>
                fee {formatMoney(preview.fee, baseCurrency, { compact: true })} ({(preview.pct * 100).toFixed(1)}%)
              </span>
            </div>
          </div>
        </div>

        <SheetFooter className="mt-auto flex-row justify-end gap-2 border-t border-border/60 bg-background/70 backdrop-blur">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Log payment"}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function AmountCurrency({
  amount, currency, currencies, onAmount, onCurrency, label,
}: {
  amount: string; currency: string; currencies: string[];
  onAmount: (v: string) => void; onCurrency: (v: string) => void; label: string;
}) {
  return (
    <div className="flex w-full items-center gap-1.5 sm:gap-2">
      <span className="w-7 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <Input
        type="number"
        inputMode="decimal"
        step="0.01"
        placeholder="0.00"
        value={amount}
        onChange={(e) => onAmount(e.target.value)}
        className="h-11 sm:h-9 flex-1 text-right tabular"
      />
      <Select items={currencies.map((c) => ({ value: c, label: c }))} value={currency} onValueChange={(v) => v && onCurrency(v)}>
        <SelectTrigger className="h-11 sm:h-9 w-[72px] sm:w-[88px] shrink-0"><SelectValue /></SelectTrigger>
        <SelectContent>
          {currencies.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
