"use client";

import NumberFlow from "@number-flow/react";
import type { CurrencyCode } from "@/lib/supabase/types";

// PHP-by-default currency, animated only on real value change (NumberFlow's
// default behaviour). Hero figures drop the cents; smaller ones can keep them.
export function MoneyFlow({
  value,
  currency = "PHP",
  maximumFractionDigits = 0,
  className,
}: {
  value: number;
  currency?: CurrencyCode;
  maximumFractionDigits?: number;
  className?: string;
}) {
  // Intl currency codes must be real ISO codes; our CurrencyCode is a superset.
  const iso = /^[A-Z]{3}$/.test(currency) ? currency : "PHP";
  return (
    <NumberFlow
      value={value}
      className={className}
      format={{ style: "currency", currency: iso, maximumFractionDigits }}
    />
  );
}
