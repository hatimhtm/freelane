"use client";

import NumberFlow from "@number-flow/react";
import { SWidget } from "@/components/widgets/s-widget";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/supabase/types";

// Spending workflow — TOP SECTION RESTYLE.
//
// Live Daily Safe S widget. Hero is liveRemaining (NumberFlow). Subtitle
// is the greyed "started today at ₱X" — the display rule everywhere.
// When today's spend overshoots the initial safe value, hero stays at 0
// (calm headline) and the subtitle swaps to a terracotta "₱X past safe"
// signal so the user doesn't lose the magnitude of the overshoot.
export function LiveDailySafeWidget({
  liveRemaining,
  initialForToday,
  overshootBase = 0,
  currency,
}: {
  liveRemaining: number;
  initialForToday: number;
  overshootBase?: number;
  currency: CurrencyCode;
}) {
  const live = Math.max(0, Math.round(liveRemaining));
  const initial = Math.max(0, Math.round(initialForToday));
  const overshoot = Math.max(0, Math.round(overshootBase));
  const isPastSafe = overshoot > 0;
  return (
    <SWidget
      label="Live daily safe"
      live
      hero={
        <NumberFlow
          value={live}
          format={{
            style: "currency",
            currency,
            maximumFractionDigits: 0,
          }}
        />
      }
      sub={
        isPastSafe ? (
          <span className="text-[var(--overdue)]">
            {formatMoney(overshoot, currency, { compact: true })} past safe
          </span>
        ) : (
          <span className="text-muted-foreground/70">
            started today at {formatMoney(initial, currency, { compact: true })}
          </span>
        )
      }
    />
  );
}
