"use client";

import * as React from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

export type WalletPickerOption = { id: string; name: string };

type WalletStatus = "positive" | "within_tolerance" | "over_overdraft";

type Props = {
  value: string | undefined;
  onValueChange: (value: string) => void;
  methods: WalletPickerOption[];
  balances: Map<string, number>;
  // Optional per-wallet tri-state from the canonical walletStatus() helper.
  // Soft terracotta dot for within_tolerance, rose for over_overdraft. Missing
  // entries render as before (no dot).
  statuses?: Map<string, WalletStatus>;
  baseCurrency: CurrencyCode;
  placeholder?: string;
  includeNone?: boolean;
  noneLabel?: string;
  noneValue?: string;
  triggerClassName?: string;
  size?: "sm" | "default";
  disabled?: boolean;
  id?: string;
};

const NONE_SENTINEL = "__none__";

function statusDot(status: WalletStatus | undefined) {
  if (!status || status === "positive") return null;
  const tone =
    status === "within_tolerance"
      ? "oklch(0.7 0.13 45)" // terracotta — soft attention
      : "oklch(0.65 0.22 25)"; // rose — alarm
  return (
    <span
      aria-hidden
      className="inline-block size-1.5 shrink-0 rounded-full"
      style={{ background: tone }}
    />
  );
}

/**
 * Drop-in wallet picker. Every option shows "Name · ₱9,566" inline so the
 * balance is part of the choice itself, not a separate lookup. When a method
 * has no known balance the bullet + amount are omitted.
 */
export function WalletPickerWithBalance({
  value,
  onValueChange,
  methods,
  balances,
  statuses,
  baseCurrency,
  placeholder = "Pick a wallet",
  includeNone = false,
  noneLabel = "None",
  noneValue = NONE_SENTINEL,
  triggerClassName,
  size = "default",
  disabled,
  id,
}: Props) {
  // Base-ui Select doesn't accept undefined as a controlled value cleanly.
  const controlled = value ?? "";

  return (
    <Select
      value={controlled}
      onValueChange={(next) => {
        const v = typeof next === "string" ? next : "";
        if (includeNone && v === noneValue) {
          onValueChange("");
          return;
        }
        onValueChange(v);
      }}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        size={size}
        className={cn("w-full", triggerClassName)}
      >
        <SelectValue placeholder={placeholder}>
          {(selected: unknown) => {
            const sel = typeof selected === "string" ? selected : controlled;
            if (!sel || (includeNone && sel === noneValue)) {
              return (
                <span className="text-muted-foreground">
                  {includeNone && sel === noneValue ? noneLabel : placeholder}
                </span>
              );
            }
            const m = methods.find((x) => x.id === sel);
            if (!m) return <span className="text-muted-foreground">{placeholder}</span>;
            const bal = balances.get(m.id);
            const st = statuses?.get(m.id);
            return (
              <span className="flex min-w-0 items-center gap-1.5">
                {statusDot(st)}
                <span className="truncate">{m.name}</span>
                {typeof bal === "number" && (
                  <>
                    <span aria-hidden className="text-foreground/40">·</span>
                    <span className="tabular text-foreground/60">
                      {formatMoney(bal, baseCurrency, { compact: true })}
                    </span>
                  </>
                )}
              </span>
            );
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {includeNone && (
          <SelectItem
            value={noneValue}
            className="h-9 text-sm text-muted-foreground"
          >
            {noneLabel}
          </SelectItem>
        )}
        {methods.map((m) => {
          const bal = balances.get(m.id);
          const st = statuses?.get(m.id);
          return (
            <SelectItem
              key={m.id}
              value={m.id}
              className="h-9 text-sm"
            >
              <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1.5 truncate">
                  {statusDot(st)}
                  <span className="truncate">{m.name}</span>
                </span>
                {typeof bal === "number" && (
                  <span className="tabular shrink-0 text-xs text-foreground/60">
                    {formatMoney(bal, baseCurrency, { compact: true })}
                  </span>
                )}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
