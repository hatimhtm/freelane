"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown } from "lucide-react";
import { toast } from "sonner";
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
import { createWithdrawal } from "@/lib/data/actions";
import type { CurrencyCode } from "@/lib/supabase/types";

type MethodOpt = { id: string; name: string; balance?: number };

export function WithdrawalSheet({
  open,
  onOpenChange,
  holdingMethods,
  destinations,
  baseCurrency,
  defaultToId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  holdingMethods: MethodOpt[];
  destinations: { id: string; name: string }[];
  baseCurrency: CurrencyCode;
  defaultToId?: string;
}) {
  const router = useRouter();
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState<string>(defaultToId ?? "");
  const [withdrawnAt, setWithdrawnAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [gross, setGross] = useState("");
  const [net, setNet] = useState("");
  const [pending, start] = useTransition();

  // Default the source wallet to the one with the largest parked balance.
  useEffect(() => {
    if (!open) return;
    const richest = [...holdingMethods].sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0))[0];
    setFromId(richest?.id ?? holdingMethods[0]?.id ?? "");
    setToId(defaultToId ?? "");
    setWithdrawnAt(new Date().toISOString().slice(0, 10));
    setGross("");
    setNet("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const fromWallet = holdingMethods.find((m) => m.id === fromId);
  const preview = useMemo(() => {
    const g = Number(gross || 0);
    const n = Number(net || 0);
    const fee = Math.max(0, g - n);
    return { gross: g, net: n, fee, pct: g > 0 ? fee / g : 0 };
  }, [gross, net]);

  function save() {
    if (!fromId) { toast.error("Pick the wallet you withdrew from."); return; }
    const g = Number(gross);
    const n = Number(net);
    if (!Number.isFinite(g) || g <= 0) { toast.error("Enter how much you took out."); return; }
    if (!Number.isFinite(n) || n < 0) { toast.error("Enter how much you received."); return; }
    if (n > g) { toast.error("Received can't be more than what you took out."); return; }
    start(async () => {
      try {
        await createWithdrawal({
          from_method_id: fromId,
          to_method_id: toId || null,
          withdrawn_at: withdrawnAt,
          gross_base: g,
          net_base: n,
        });
        toast.success(`Withdrawal logged · ${formatMoney(n, baseCurrency)} in hand`);
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
          <SheetTitle>Log a withdrawal</SheetTitle>
          <SheetDescription>
            Move money out of a holding wallet. The fee is what you took out minus what you actually received.
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-5 px-4 py-6">
          <div className="grid grid-cols-2 gap-4">
            <Field label="From wallet">
              <Select
                items={holdingMethods.map((m) => ({ value: m.id, label: m.name }))}
                value={fromId}
                onValueChange={(v) => v && setFromId(v)}
              >
                <SelectTrigger className="w-full"><SelectValue placeholder="Pick a wallet" /></SelectTrigger>
                <SelectContent>
                  {holdingMethods.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Date">
              <Input type="date" value={withdrawnAt} onChange={(e) => setWithdrawnAt(e.target.value)} />
            </Field>
          </div>

          {fromWallet?.balance !== undefined && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Parked in {fromWallet.name}:{" "}
              <span className="font-medium text-foreground tabular">{formatMoney(fromWallet.balance, baseCurrency, { compact: true })}</span>
            </p>
          )}

          <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
            <div className="grid grid-cols-[1fr_auto] items-center gap-2">
              <AmountRow label="Out" amount={gross} onAmount={setGross} baseCurrency={baseCurrency} />
            </div>
            <div className="my-1 flex justify-center text-muted-foreground/50"><ArrowDown className="h-3 w-3" /></div>
            <div className="grid grid-cols-[1fr_auto] items-center gap-2">
              <AmountRow label="Got" amount={net} onAmount={setNet} baseCurrency={baseCurrency} />
            </div>
            <div className="mt-2 border-t border-border/50 pt-2">
              <Field label="To (optional)">
                <Select
                  items={destinations.map((m) => ({ value: m.id, label: m.name }))}
                  value={toId}
                  onValueChange={(v) => setToId(v ?? "")}
                >
                  <SelectTrigger className="h-9 w-full text-sm"><SelectValue placeholder="Cash" /></SelectTrigger>
                  <SelectContent>
                    {destinations.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--overdue)]/40 bg-card p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Withdrawal fee</span>
              <span className="text-2xl font-semibold tabular text-[var(--overdue)]">{formatMoney(preview.fee, baseCurrency)}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground tabular">
              <span>{formatMoney(preview.net, baseCurrency, { compact: true })} in hand</span>
              <span>{(preview.pct * 100).toFixed(1)}% of what you moved</span>
            </div>
          </div>
        </div>

        <SheetFooter className="mt-auto flex-row justify-end gap-2 border-t border-border/60 bg-background/70 backdrop-blur">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Log withdrawal"}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function AmountRow({
  label, amount, onAmount, baseCurrency,
}: {
  label: string; amount: string; onAmount: (v: string) => void; baseCurrency: CurrencyCode;
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
      <span className="grid h-11 sm:h-9 w-[72px] sm:w-[88px] shrink-0 place-items-center rounded-md border border-input bg-muted/40 text-sm text-muted-foreground">{baseCurrency}</span>
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
