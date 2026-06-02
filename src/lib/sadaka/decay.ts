import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { phtDateString } from "@/lib/utils";
import { readPoolBalanceForUser } from "./ledger";
import { getSadakaConfigForUser } from "./config";

// Freelane Sadaka — daily decay.
//
// Captures the religious-cultural sense that old unpaid sadaka isn't
// eternal debt — relevance fades. Default rate is 4%/month, so per-day
// decay is current_pool * (decay_pct_monthly / 30).
//
// Idempotent per PHT day: before writing a decay row we check whether a
// LIVE decay row already exists for today's PHT date. The cron retries
// won't double-decay; manual ad-hoc calls won't either.
//
// Skips when:
//   - pool ≤ 0 (no decay against an empty pool)
//   - decay rate is zero
//   - a decay row already exists for today
//
// Service client only: this entry point is cron-driven and must work
// without an authenticated session. The companion typed readers
// (readPoolBalanceForUser, getSadakaConfigForUser) are kept exported in
// `./ledger` and `./config` for in-session callers.

export async function runDailyDecay(userId: string): Promise<{
  ok: boolean;
  skipped?: "no_pool" | "no_rate" | "already_today";
  amountBase?: number;
}> {
  try {
    if (!userId) return { ok: false };
    const supabase = createServiceClient();

    // Config read — getSadakaConfigForUser now uses the service client so
    // it works from cron. Default-fallback is owned by the config reader,
    // not duplicated here.
    const cfg = await getSadakaConfigForUser(userId);
    const decayRate = cfg.decay_pct_monthly;
    if (!(decayRate > 0)) return { ok: true, skipped: "no_rate" };

    // Pool read via the canonical reader so request-side and cron-side
    // share the same math. Floors at zero for the decay base.
    const pool = await readPoolBalanceForUser(userId);
    const poolDisplay = pool.displayBase;
    if (!(poolDisplay > 0)) return { ok: true, skipped: "no_pool" };

    // PHT-day dedup. The partial unique index doesn't apply to decay rows
    // (source_id is null) so we check by kind + event_at window directly.
    const today = phtDateString(new Date());
    const dayStartUtc = new Date(`${today}T00:00:00+08:00`).toISOString();
    const dayEndUtc = new Date(`${today}T23:59:59+08:00`).toISOString();
    const { data: existing } = await supabase
      .from("sadaka_ledger")
      .select("id")
      .eq("user_id", userId)
      .eq("kind", "decay")
      .is("archived_at", null)
      .gte("event_at", dayStartUtc)
      .lte("event_at", dayEndUtc)
      .limit(1);
    if ((existing ?? []).length > 0) {
      return { ok: true, skipped: "already_today" };
    }

    // Month-aware daily rate. Using the actual days-in-month for the PHT
    // calendar month keeps the annualised decay honest across 28/29/30/31
    // day months.
    const phtTodayDate = new Date(`${today}T12:00:00+08:00`);
    const daysInMonth = new Date(
      phtTodayDate.getUTCFullYear(),
      phtTodayDate.getUTCMonth() + 1,
      0,
    ).getDate();
    const dailyRate = decayRate / daysInMonth / 100;
    const decayAmount = Math.round(poolDisplay * dailyRate * 100) / 100;
    if (!(decayAmount > 0)) return { ok: true, skipped: "no_pool" };

    // Anchor event_at to PHT-noon of today so storage matches the dedup
    // window's PHT-day semantics. The cron's UTC-now would also fall inside
    // the window today, but anchoring removes the dependence on cron-fire
    // time and matches how the rest of Freelane stores day-bucketed events.
    const eventAt = new Date(`${today}T12:00:00+08:00`).toISOString();

    const { error: insertErr } = await supabase
      .from("sadaka_ledger")
      .insert({
        user_id: userId,
        event_at: eventAt,
        kind: "decay",
        amount_base: -1 * decayAmount,
        reasoning: `Decay · ${decayRate}% monthly`,
      });
    if (insertErr) return { ok: false };

    return { ok: true, amountBase: decayAmount };
  } catch {
    return { ok: false };
  }
}
