"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown } from "lucide-react";
import { toast } from "sonner";
import {
  CenterModal,
  CenterModalBody,
  CenterModalFooter,
} from "@/components/ui/center-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WalletPickerWithBalance } from "@/components/app/wallet-picker";
import { formatMoney } from "@/lib/money";
import { createWithdrawal } from "@/lib/data/actions";
import { phtToday } from "@/lib/utils";
import type { CurrencyCode } from "@/lib/supabase/types";

type MethodOpt = { id: string; name: string; balance?: number };

export function WithdrawalModal({
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
  const [withdrawnAt, setWithdrawnAt] = useState(() => phtToday());
  const [gross, setGross] = useState("");
  const [net, setNet] = useState("");
  const [pending, start] = useTransition();

  // Default the source wallet to the one with the largest parked balance.
  useEffect(() => {
    if (!open) return;
    const richest = [...holdingMethods].sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0))[0];
    setFromId(richest?.id ?? holdingMethods[0]?.id ?? "");
    setToId(defaultToId ?? "");
    setWithdrawnAt(phtToday());
    setGross("");
    setNet("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Balance map shared by both pickers. Holding wallets have known balances;
  // arbitrary destinations (e.g. Cash) are present without a balance, which the
  // picker hides gracefully.
  const balances = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of holdingMethods) {
      if (typeof h.balance === "number") m.set(h.id, h.balance);
    }
    return m;
  }, [holdingMethods]);

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
    <CenterModal
      open={open}
      onOpenChange={onOpenChange}
      title="Log a withdrawal"
      description="Move money out of a holding wallet. The fee is what you took out minus what you actually received."
      size="md"
    >
      <CenterModalBody>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="From wallet">
              <WalletPickerWithBalance
                value={fromId}
                onValueChange={(v) => v && setFromId(v)}
                methods={holdingMethods.map(({ id, name }) => ({ id, name }))}
                balances={balances}
                baseCurrency={baseCurrency}
                placeholder="Pick a wallet"
              />
            </Field>
            <Field label="Date">
              <Input type="date" value={withdrawnAt} onChange={(e) => setWithdrawnAt(e.target.value)} />
            </Field>
          </div>

          <div className="rounded-[12px] border border-border/60 bg-muted/30 p-3">
            <AmountRow label="Out" amount={gross} onAmount={setGross} baseCurrency={baseCurrency} />
            <div className="my-1 flex justify-center text-muted-foreground/50"><ArrowDown className="h-3 w-3" /></div>
            <AmountRow label="Got" amount={net} onAmount={setNet} baseCurrency={baseCurrency} />
            <div className="mt-2 border-t border-border/50 pt-2">
              <Field label="To (optional)">
                <WalletPickerWithBalance
                  value={toId}
                  onValueChange={setToId}
                  methods={destinations}
                  balances={balances}
                  baseCurrency={baseCurrency}
                  placeholder="Cash"
                  includeNone
                  noneLabel="Cash"
                  size="sm"
                />
              </Field>
            </div>
          </div>

          <div className="rounded-[12px] border border-[var(--overdue)]/40 bg-card p-3">
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
      </CenterModalBody>

      <CenterModalFooter>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Log withdrawal"}</Button>
      </CenterModalFooter>
    </CenterModal>
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
        className="h-9 flex-1 text-right tabular"
      />
      <span className="grid h-9 w-[72px] sm:w-[88px] shrink-0 place-items-center rounded-md border border-input bg-muted/40 text-sm text-muted-foreground">{baseCurrency}</span>
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
