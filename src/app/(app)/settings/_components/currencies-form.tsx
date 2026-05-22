"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw, Trash2 } from "lucide-react";
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
  createCurrency,
  deleteExchangeRate,
  refreshExchangeRatesFromAPI,
  updateSettings,
  upsertExchangeRate,
} from "@/lib/data/actions";
import type { Currency, ExchangeRate, Settings } from "@/lib/supabase/types";

export function CurrenciesForm({
  settings,
  rates,
  currencies,
}: {
  settings: Settings | null;
  rates: ExchangeRate[];
  currencies: Currency[];
}) {
  const router = useRouter();
  const [base, setBase] = useState(settings?.base_currency ?? "PHP");
  const [local, setLocal] = useState<Record<string, string>>(() =>
    Object.fromEntries(rates.map((r) => [r.code, String(r.rate_to_base)])),
  );
  const [pending, start] = useTransition();

  const activeCodes = Object.keys(local);
  const availableToAdd = currencies.filter((c) => !activeCodes.includes(c.code));

  async function saveBase(next: string | null) {
    if (!next) return;
    setBase(next);
    try {
      await updateSettings({ base_currency: next });
      toast.success(`Base set to ${next}`);
      router.refresh();
    } catch (err: unknown) {
      toast.error((err as Error).message);
    }
  }

  function onRateChange(code: string, value: string) {
    setLocal((prev) => ({ ...prev, [code]: value }));
  }

  function saveRate(code: string) {
    const value = Number(local[code]);
    if (!value || value <= 0) {
      toast.error("Rate must be a positive number");
      return;
    }
    start(async () => {
      try {
        await upsertExchangeRate(code, value);
        toast.success(`${code} rate saved`);
        router.refresh();
      } catch (err: unknown) {
        toast.error((err as Error).message);
      }
    });
  }

  async function removeRate(code: string) {
    try {
      await deleteExchangeRate(code);
      setLocal((prev) => {
        const next = { ...prev };
        delete next[code];
        return next;
      });
      toast.success(`${code} removed`);
      router.refresh();
    } catch (err: unknown) {
      toast.error((err as Error).message);
    }
  }

  function addCurrency(code: string | null) {
    if (!code) return;
    setLocal((prev) => ({ ...prev, [code]: "1" }));
  }

  function refreshFromAPI() {
    start(async () => {
      try {
        const result = await refreshExchangeRatesFromAPI();
        if (result.updated === 0) {
          toast.info("Nothing to refresh — add a currency first.");
        } else {
          toast.success(`Refreshed ${result.updated} rate${result.updated === 1 ? "" : "s"} from frankfurter.app`);
          router.refresh();
        }
      } catch (err: unknown) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <Label className="text-xs font-medium text-muted-foreground">Base currency</Label>
        <div className="mt-1.5 flex items-center gap-2">
          <Select
            items={currencies.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))}
            value={base}
            onValueChange={saveBase}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {currencies.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Dashboard totals and charts convert into this currency.
          </p>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label className="text-xs font-medium text-muted-foreground">
            Exchange rates to {base}
          </Label>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={refreshFromAPI}
              disabled={pending || Object.keys(local).length === 0}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} />
              {pending ? "Refreshing…" : "Refresh from API"}
            </Button>
            {availableToAdd.length > 0 && (
              <Select
                items={availableToAdd.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))}
                onValueChange={addCurrency}
              >
                <SelectTrigger className="h-8 w-40 text-xs">
                  <SelectValue placeholder="Add currency…" />
                </SelectTrigger>
                <SelectContent>
                  {availableToAdd.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.code} · {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border/60">
          <table className="w-full text-sm">
            <thead className="border-b border-border/60 bg-muted/40">
              <tr className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 text-left">Currency</th>
                <th className="px-4 py-2 text-left">1 unit =</th>
                <th className="px-4 py-2 text-right">In {base}</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {Object.entries(local).map(([code, value]) => {
                const currency = currencies.find((c) => c.code === code);
                const isBase = code === base;
                return (
                  <tr key={code} className="group">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{code}</div>
                      <div className="text-xs text-muted-foreground">
                        {currency?.name ?? ""}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">1 {code}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        <Input
                          type="number"
                          inputMode="decimal"
                          step="0.0001"
                          disabled={isBase}
                          value={isBase ? "1" : value}
                          onChange={(e) => onRateChange(code, e.target.value)}
                          onBlur={() => !isBase && saveRate(code)}
                          className="h-8 w-32 text-right tabular"
                        />
                        <span className="text-xs text-muted-foreground">{base}</span>
                      </div>
                    </td>
                    <td className="pr-3">
                      {!isBase && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                          onClick={() => removeRate(code)}
                          disabled={pending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {Object.keys(local).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Add a currency to start tracking rates.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Edit rates by hand, or pull live mid-market rates from{" "}
          <a
            href="https://www.frankfurter.app"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            frankfurter.app
          </a>{" "}
          (free, ECB-sourced, no API key).
        </p>

        <NewCurrency onCreated={() => router.refresh()} />
      </div>
    </div>
  );
}

function NewCurrency({ onCreated }: { onCreated: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  function add() {
    if (!/^[A-Za-z]{3}$/.test(code.trim())) { toast.error("Code must be 3 letters (e.g. GBP)"); return; }
    if (!name.trim()) { toast.error("Add a name"); return; }
    start(async () => {
      try {
        await createCurrency({ code: code.trim(), name: name.trim() });
        toast.success(`${code.toUpperCase()} added`);
        setCode(""); setName("");
        onCreated();
      } catch (err) { toast.error((err as Error).message); }
    });
  }

  return (
    <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-border/50 pt-4">
      <div>
        <Label className="text-xs font-medium text-muted-foreground">New currency</Label>
        <div className="mt-1.5 flex items-center gap-2">
          <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 3))} placeholder="GBP" className="h-8 w-20 uppercase" />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="British Pound" className="h-8 w-44" />
          <Button size="sm" variant="outline" className="h-8" onClick={add} disabled={pending}>{pending ? "Adding…" : "Add"}</Button>
        </div>
      </div>
    </div>
  );
}
