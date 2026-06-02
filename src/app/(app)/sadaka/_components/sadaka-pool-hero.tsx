"use client";

import { useState, useTransition } from "react";
import { HandHeart } from "lucide-react";
import { toast } from "sonner";
import NumberFlow from "@number-flow/react";

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
import { MWidget } from "@/components/widgets/m-widget";
import { markSadakaGiven } from "../actions";
import type { CurrencyCode } from "@/lib/supabase/types";

// HERO (M widget): pool balance + suggested today sub-line + Mark sadaka
// given CTA. The CTA opens a center modal that writes a payment ledger row
// AND a money_ledger sadaka_payment outflow tied to the picked wallet.

type Props = {
  poolBase: number;
  suggestedToday: number;
  suggestedReasoning: string;
  currency: CurrencyCode;
  wallets: Array<{ id: string; name: string }>;
};

export function SadakaPoolHero({
  poolBase,
  suggestedToday,
  suggestedReasoning,
  currency,
  wallets,
}: Props) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<string>(
    suggestedToday > 0 ? String(Math.round(suggestedToday)) : "",
  );
  const [walletId, setWalletId] = useState<string>(wallets[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  const sub =
    suggestedToday > 0
      ? `Suggested today · ${currency} ${Math.round(suggestedToday)}`
      : "Reserve pool for voluntary giving";

  const supporting = suggestedReasoning || undefined;

  function save() {
    const a = Number(amount);
    if (!(a > 0)) {
      toast.error("Amount must be greater than 0.");
      return;
    }
    if (!walletId) {
      toast.error("Pick a wallet.");
      return;
    }
    start(async () => {
      const res = await markSadakaGiven({
        amountBase: a,
        walletId,
        note: note.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.error || "Couldn't save the sadaka payment.");
        return;
      }
      toast.success(`Sadaka given · ${currency} ${Math.round(a)}`);
      setOpen(false);
      setNote("");
    });
  }

  return (
    <>
      <MWidget
        eyebrow="Pool"
        icon={<HandHeart className="h-4 w-4" />}
        hero={
          <span className="tabular-nums">
            {currency}{" "}
            <NumberFlow
              value={poolBase}
              format={{ maximumFractionDigits: 0 }}
            />
          </span>
        }
        sub={sub}
        supporting={supporting}
        trailing={
          <Button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
            }}
            size="sm"
            variant="default"
          >
            Mark sadaka given
          </Button>
        }
        aiDot={{ key: "sadaka.pool", label: "Sadaka pool" }}
      />

      <CenterModal
        open={open}
        onOpenChange={setOpen}
        title="Mark sadaka given"
        description="Logs a payment row and debits the picked wallet."
        size="sm"
      >
        <CenterModalBody>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sadaka-amount" className="text-xs">
                Amount ({currency})
              </Label>
              <Input
                id="sadaka-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="tabular text-right text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Wallet</Label>
              <Select value={walletId} onValueChange={(v) => setWalletId(v ?? "")}>
                <SelectTrigger className="h-8 text-sm">
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
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sadaka-note" className="text-xs">
                Note (optional)
              </Label>
              <Input
                id="sadaka-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="To whom · where · why"
                className="text-sm"
              />
            </div>
          </div>
        </CenterModalBody>
        <CenterModalFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </CenterModalFooter>
      </CenterModal>
    </>
  );
}
