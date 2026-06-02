"use client";

import NumberFlow from "@number-flow/react";

// Thin wrapper around NumberFlow for non-currency hero numerics on widgets.
// Per locked widget system: "AnimatedNumber / NumberFlow wrap on every hero
// number so it animates on data change." This is the reusable primitive for
// runway days, cigarettes today count, sleep hours, avg-days-to-payment, etc.
export function NumberHero({
  value,
  suffix,
  prefix,
  maximumFractionDigits = 0,
  minimumFractionDigits,
  className,
}: {
  value: number;
  suffix?: string;
  prefix?: string;
  maximumFractionDigits?: number;
  minimumFractionDigits?: number;
  className?: string;
}) {
  return (
    <span className={className}>
      {prefix}
      <NumberFlow
        value={value}
        format={{
          maximumFractionDigits,
          minimumFractionDigits: minimumFractionDigits ?? 0,
        }}
      />
      {suffix}
    </span>
  );
}
