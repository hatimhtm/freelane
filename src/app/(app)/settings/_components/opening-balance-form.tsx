"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import NumberFlow from "@number-flow/react";
import { toast } from "sonner";
import { setWalletOpeningBalance } from "@/lib/data/actions";
import type { Currency, PaymentMethod } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

type Row = {
  amount: string;
  date: string;
  initialAmount: number;
  initialDate: string;
};

const TODAY = () => new Date().toISOString().slice(0, 10);

export function OpeningBalanceForm({
  methods,
  currencies,
}: {
  methods: PaymentMethod[];
  currencies: Currency[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const holding = useMemo(
    () => methods.filter((m) => m.is_holding && !m.archived),
    [methods],
  );

  const [rows, setRows] = useState<Record<string, Row>>(() => {
    const out: Record<string, Row> = {};
    for (const m of holding) {
      const amt = m.opening_balance_base ?? 0;
      out[m.id] = {
        amount: amt > 0 ? String(amt) : "",
        date: m.opening_balance_at ?? TODAY(),
        initialAmount: amt,
        initialDate: m.opening_balance_at ?? TODAY(),
      };
    }
    return out;
  });

  const total = useMemo(
    () =>
      Object.values(rows).reduce((sum, r) => {
        const n = Number(r.amount);
        return sum + (Number.isFinite(n) && n > 0 ? n : 0);
      }, 0),
    [rows],
  );

  const dirty = useMemo(
    () =>
      Object.entries(rows).some(([, r]) => {
        const n = Number(r.amount);
        const next = Number.isFinite(n) && n > 0 ? n : 0;
        return next !== r.initialAmount || r.date !== r.initialDate;
      }),
    [rows],
  );

  if (holding.length === 0) {
    return (
      <p className="text-sm leading-relaxed text-muted-foreground">
        No holding wallets yet. Mark a payment method as a holding wallet (coin.ph, Cash, GCash…)
        and its starting balance will live here.
      </p>
    );
  }

  function save() {
    start(async () => {
      const changes = Object.entries(rows).filter(([, r]) => {
        const n = Number(r.amount);
        const next = Number.isFinite(n) && n > 0 ? n : 0;
        return next !== r.initialAmount || r.date !== r.initialDate;
      });
      if (changes.length === 0) return;
      try {
        await Promise.all(
          changes.map(([methodId, r]) =>
            setWalletOpeningBalance({
              methodId,
              amountBase: Number(r.amount) || 0,
              dateOpt: r.date || TODAY(),
            }),
          ),
        );
        toast.success("Wallet balances set");
        setRows((prev) => {
          const next = { ...prev };
          for (const [methodId] of changes) {
            const r = prev[methodId];
            next[methodId] = {
              ...r,
              initialAmount: Number(r.amount) || 0,
              initialDate: r.date,
            };
          }
          return next;
        });
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div role="list" className="divide-y divide-border/50 border-y border-border/50">
        {holding.map((m) => {
          const row = rows[m.id];
          return (
            <Row
              key={m.id}
              method={m}
              row={row}
              currencies={currencies}
              onChange={(patch) =>
                setRows((prev) => ({ ...prev, [m.id]: { ...prev[m.id], ...patch } }))
              }
            />
          );
        })}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-6 pt-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Total on hand
          </div>
          <div className="mt-2 font-fraunces text-[44px] leading-none tracking-tight tabular text-foreground">
            <NumberFlow
              value={Math.round(total)}
              format={{ style: "currency", currency: "PHP", maximumFractionDigits: 0 }}
              transformTiming={{ duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className={cn(
            "h-10 rounded-lg bg-[var(--brand)] px-5 text-[13px] font-medium tracking-tight text-[var(--brand-foreground)]",
            "transition-opacity duration-300 ease-out",
            "hover:opacity-90 active:translate-y-px",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {pending ? "Saving" : "Save balances"}
        </button>
      </div>
    </div>
  );
}

function Row({
  method,
  row,
  currencies,
  onChange,
}: {
  method: PaymentMethod;
  row: Row;
  currencies: Currency[];
  onChange: (patch: Partial<Row>) => void;
}) {
  const baseCurrency = (method.currency_out ?? "PHP") as string;
  const symbol = currencies.find((c) => c.code === baseCurrency)?.symbol ?? "₱";
  const wasSet = row.initialAmount > 0;

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 py-5 sm:grid-cols-[1fr_auto_auto] sm:gap-x-8">
      <div className="min-w-0">
        <div className="truncate text-[15px] font-medium text-foreground">{method.name}</div>
        <div className="mt-0.5 text-[12px] text-muted-foreground tabular">
          {wasSet
            ? `Anchored ${formatLightDate(row.initialDate)}`
            : "Starts counting from this number"}
        </div>
      </div>

      <label className="group relative col-start-1 row-start-2 flex items-center sm:col-start-2 sm:row-start-1">
        <span className="pointer-events-none absolute left-3 text-[15px] text-muted-foreground">
          {symbol}
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={row.amount}
          onChange={(e) => onChange({ amount: cleanNumeric(e.target.value) })}
          placeholder="0"
          className={cn(
            "h-11 w-[160px] rounded-lg border border-border/70 bg-transparent pl-8 pr-3 text-right text-[17px] tabular tracking-tight text-foreground",
            "outline-none transition-colors duration-300 ease-out",
            "placeholder:text-foreground/25",
            "focus:border-foreground/40",
          )}
        />
      </label>

      <input
        type="date"
        value={row.date}
        max={TODAY()}
        onChange={(e) => onChange({ date: e.target.value || TODAY() })}
        aria-label={`Anchor date for ${method.name}`}
        className={cn(
          "col-start-2 row-start-2 h-11 rounded-lg border border-border/70 bg-transparent px-3 text-[13px] text-muted-foreground tabular",
          "outline-none transition-colors duration-300 ease-out",
          "focus:border-foreground/40 focus:text-foreground",
          "sm:col-start-3 sm:row-start-1",
        )}
      />
    </div>
  );
}

function cleanNumeric(v: string): string {
  // Permit digits + a single decimal point; strip leading zeros so the typed
  // value feels live rather than auto-corrected mid-keystroke.
  const cleaned = v.replace(/[^\d.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length <= 1) return cleaned;
  return `${parts[0]}.${parts.slice(1).join("").slice(0, 2)}`;
}

function formatLightDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
