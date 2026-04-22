import type { CurrencyCode, ExchangeRate } from "@/lib/supabase/types";

const SYMBOLS: Record<string, string> = {
  PHP: "₱", USD: "$", EUR: "€", MAD: "MAD ", CNY: "¥",
};

export function formatMoney(
  amount: number,
  currency: CurrencyCode,
  opts: { compact?: boolean } = {},
) {
  const abs = Math.abs(amount);
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: opts.compact && abs >= 10000 ? 0 : 2,
    maximumFractionDigits: opts.compact && abs >= 10000 ? 0 : 2,
  }).format(amount);
  return `${SYMBOLS[currency] ?? currency + " "}${formatted}`;
}

export function convert(
  amount: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  rates: Pick<ExchangeRate, "code" | "rate_to_base">[],
): number {
  if (fromCurrency === toCurrency) return amount;
  const rateFrom = rates.find((r) => r.code === fromCurrency)?.rate_to_base;
  const rateTo   = rates.find((r) => r.code === toCurrency)?.rate_to_base;
  if (!rateFrom || !rateTo) return amount;
  // rate_to_base is "X base units per 1 unit of `code`"
  const inBase = amount * rateFrom;
  return inBase / rateTo;
}

export function toBase(
  amount: number,
  currency: CurrencyCode,
  rates: Pick<ExchangeRate, "code" | "rate_to_base">[],
): number {
  const rate = rates.find((r) => r.code === currency)?.rate_to_base ?? 1;
  return amount * rate;
}
