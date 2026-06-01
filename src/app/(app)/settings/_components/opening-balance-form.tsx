"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import NumberFlow from "@number-flow/react";
import { toast } from "sonner";
import { setWalletOpeningBalance } from "@/lib/data/actions";
import type { Currency, CurrencyCode, PaymentMethod } from "@/lib/supabase/types";
import { cn, normalizeAmountInput, phtToday } from "@/lib/utils";

type Row = {
  amount: string;
  currency: CurrencyCode;
  date: string;
  initialAmount: number;
  initialCurrency: CurrencyCode;
  initialDate: string;
  // Whether the wallet was ever anchored. Different from "amount > 0":
  // an unanchored wallet has opening_balance_at = NULL and should accept
  // 0 as a valid first save (Hatim 2026-06-01 — "setting up a wallet to
  // zero doesn't even let me save").
  wasAnchored: boolean;
};

const TODAY = phtToday;
const BASE_FALLBACK: CurrencyCode = "PHP";

export function OpeningBalanceForm({
  methods,
  currencies,
  baseCurrency,
}: {
  methods: PaymentMethod[];
  currencies: Currency[];
  baseCurrency: CurrencyCode;
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
      // The form is a write-only calibration surface — every load comes up
      // blank so the user can't accidentally re-apply yesterday's number
      // by hitting Save without thinking. The saved value still drives every
      // other surface; the live balance shows in the spend modal / Today /
      // Payments via the holdingBalances math.
      const nativeCcy = (m.opening_balance_currency ?? m.currency_out ?? baseCurrency) as CurrencyCode;
      const wasAnchored = m.opening_balance_at !== null;
      out[m.id] = {
        amount: "",
        currency: nativeCcy,
        date: TODAY(),
        initialAmount: 0,
        initialCurrency: nativeCcy,
        initialDate: TODAY(),
        wasAnchored,
      };
    }
    return out;
  });

  // Build a quick code → unit price lookup so the total can stay roughly
  // accurate when wallets are in different currencies. The lookup is from
  // the currency list which carries the symbol; conversions to the base
  // currency happen server-side at save time.
  const codeToSymbol = useMemo(() => new Map(currencies.map((c) => [c.code, c.symbol ?? c.code])), [currencies]);

  // Sum of typed amounts — purely display; the real PHP-base value gets
  // computed and stored server-side using the live FX rate.
  const total = useMemo(
    () =>
      Object.values(rows).reduce((sum, r) => {
        const n = Number(r.amount);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0),
    [rows],
  );

  // The form is write-only and always starts blank, so ANY value the user
  // typed counts as a re-anchor request — including 0. Don't compare to
  // initialAmount: "type 0, save 0" must work even when the prior anchor
  // was already 0 (most wallets ARE 0; that's the common case).
  function isExplicit(amount: string): boolean {
    const trimmed = amount.trim();
    if (trimmed === "" || trimmed === "-") return false;
    return Number.isFinite(Number(trimmed));
  }

  const dirty = useMemo(
    () => Object.values(rows).some((r) => isExplicit(r.amount)),
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
      const changes = Object.entries(rows).filter(([, r]) => isExplicit(r.amount));
      if (changes.length === 0) return;
      const results = await Promise.all(
        changes.map(([methodId, r]) => {
          const n = Number(r.amount.trim());
          const amount = Number.isFinite(n) ? n : 0;
          return setWalletOpeningBalance({
            methodId,
            amount,
            amountCurrency: r.currency,
            dateOpt: r.date || TODAY(),
          });
        }),
      );
      const firstError = results.find((r) => !r.ok);
      if (firstError && !firstError.ok) {
        toast.error(firstError.error || "Couldn't save balances.");
        return;
      }
      toast.success("Wallet balances saved.");
      // Calibration is a one-shot: clear every input so the form stops
      // looking "dirty" and the user doesn't accidentally re-apply the same
      // numbers on the next click. The saved values still drive every
      // surface that reads holdingBalances — Today, the spend modal,
      // Payments — via the revalidatePath sweep on the server.
      setRows((prev) => {
        const next = { ...prev };
        for (const methodId in next) {
          next[methodId] = {
            ...next[methodId],
            amount: "",
            initialAmount: 0,
            initialCurrency: next[methodId].currency,
            initialDate: next[methodId].date,
            wasAnchored: true,
          };
        }
        return next;
      });
      router.refresh();
    });
  }

  // The summed amounts are in mixed currencies; only render the value when
  // every wallet is in the same currency. Otherwise show the count as a hint.
  const sameCurrency = useMemo(() => {
    const seen = new Set(Object.values(rows).map((r) => r.currency));
    return seen.size === 1 ? [...seen][0] : null;
  }, [rows]);

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
              codeToSymbol={codeToSymbol}
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
            {sameCurrency ? (
              <NumberFlow
                value={Math.round(total)}
                format={{ style: "currency", currency: sameCurrency, maximumFractionDigits: 0 }}
                transformTiming={{ duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}
              />
            ) : (
              <span className="text-foreground/70">{Object.keys(rows).length} wallets</span>
            )}
          </div>
          {!sameCurrency && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Mixed currencies — the math layer converts each to {baseCurrency} at save time.
            </p>
          )}
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
  codeToSymbol,
  onChange,
}: {
  method: PaymentMethod;
  row: Row;
  currencies: Currency[];
  codeToSymbol: Map<string, string>;
  onChange: (patch: Partial<Row>) => void;
}) {
  const symbol = codeToSymbol.get(row.currency) ?? row.currency;
  const wasSet = row.wasAnchored;

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 py-5 sm:grid-cols-[1fr_auto_auto_auto] sm:gap-x-6">
      <div className="min-w-0">
        <div className="truncate text-[15px] font-medium text-foreground">{method.name}</div>
        <div className="mt-0.5 text-[12px] text-muted-foreground tabular">
          {wasSet
            ? `Anchored ${formatLightDate(row.initialDate)} — everywhere else reads this + activity since.`
            : "Calibration starts here. Pre-anchor activity is treated as already baked in."}
        </div>
      </div>

      <label className="group relative col-start-1 row-start-2 flex items-center sm:col-start-2 sm:row-start-1">
        <span className="pointer-events-none absolute left-3 text-[13px] text-muted-foreground">
          {symbol}
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={row.amount}
          onChange={(e) =>
            // Re-anchor to today whenever the amount changes so "what I type"
            // equals "what shows everywhere" — no surprise drift from pre-anchor
            // activity. The user can still backdate manually via the date picker
            // for one-off historical anchors.
            onChange({ amount: normalizeAmountInput(e.target.value), date: TODAY() })
          }
          placeholder="0"
          className={cn(
            "h-11 w-[150px] rounded-lg border border-border/70 bg-transparent pl-8 pr-3 text-right text-[17px] tabular tracking-tight text-foreground",
            "outline-none transition-colors duration-300 ease-out",
            "placeholder:text-foreground/25",
            "focus:border-foreground/40",
          )}
        />
      </label>

      <select
        value={row.currency}
        onChange={(e) => onChange({ currency: e.target.value as CurrencyCode })}
        aria-label={`Currency for ${method.name}`}
        className={cn(
          "col-start-2 row-start-2 h-11 rounded-lg border border-border/70 bg-transparent px-2 text-[13px] tabular text-foreground/90",
          "outline-none transition-colors duration-300 ease-out",
          "focus:border-foreground/40",
          "sm:col-start-3 sm:row-start-1",
        )}
      >
        {currencies.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code}
          </option>
        ))}
      </select>

      <input
        type="date"
        value={row.date}
        max={TODAY()}
        onChange={(e) => onChange({ date: e.target.value || TODAY() })}
        aria-label={`Anchor date for ${method.name}`}
        className={cn(
          "col-start-2 row-start-3 h-11 rounded-lg border border-border/70 bg-transparent px-3 text-[13px] text-muted-foreground tabular",
          "outline-none transition-colors duration-300 ease-out",
          "focus:border-foreground/40 focus:text-foreground",
          "sm:col-start-4 sm:row-start-1",
        )}
      />
    </div>
  );
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
