"use server";

import { withBrainCache, fingerprintFromIds } from "@/lib/ai/cache";
import { BRAIN_KEYS } from "@/lib/ai/cache-keys";
import { getAuthUser } from "@/lib/auth";
import { phtDateString, phtToday } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { readPoolBalance } from "./ledger";
import { decideSadakaSuggestedToday } from "@/lib/ai/brains/sadaka-suggested-today";

// Freelane Sadaka — daily nudge suggestion.
//
// Wraps the sadaka_suggested_today brain in the standard withBrainCache
// pattern (24h TTL, PHT-day anchored, fingerprint from pool balance + day).
// Used by:
//   - Today widget (relevance-gated by surface_today && suggested_amount > 0)
//   - Sadaka tab hero ("suggested today" sub line)
//   - Dashboard card
//   - sadaka_nudge dispatcher (silence check + threshold)

export type SuggestedToday = {
  suggested_amount: number;
  reasoning: string;
  surface_today: boolean;
};

export const EMPTY_SUGGESTION: SuggestedToday = {
  suggested_amount: 0,
  reasoning: "",
  surface_today: false,
};

// Lightweight context bundle: cash on hand + upcoming 7d outflows +
// silence-window days. Period stage is left as "neutral" until the
// dedicated period engine ships; the brain still receives the other three.
async function gatherSuggestedSignals(userId: string): Promise<{
  liquidityBase: number;
  upcomingOutflows7dBase: number;
  daysSinceLastPayment: number | null;
}> {
  try {
    const supabase = await createClient();
    const todayIso = new Date().toISOString();
    const horizonIso = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const [ledgerRes, plannedRes, lastGivenRes] = await Promise.all([
      // Wallet balance from money_ledger — sum of live rows.
      supabase
        .from("money_ledger")
        .select("amount_base")
        .eq("user_id", userId)
        .is("archived_at", null),
      supabase
        .from("planned_spends")
        .select("expected_base,planned_for,status")
        .eq("user_id", userId)
        .in("status", ["planned", "committed"])
        .gte("planned_for", todayIso)
        .lte("planned_for", horizonIso),
      supabase
        .from("sadaka_ledger")
        .select("event_at")
        .eq("user_id", userId)
        .in("kind", ["payment", "auto_detected"])
        .is("archived_at", null)
        .order("event_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const liquidity = (ledgerRes.data ?? []).reduce(
      (s, r) => s + Number((r as { amount_base: number | string }).amount_base ?? 0),
      0,
    );
    const upcoming = (plannedRes.data ?? []).reduce(
      (s, r) => s + Number((r as { expected_base: number | string }).expected_base ?? 0),
      0,
    );
    let daysSince: number | null = null;
    const lastRow = lastGivenRes.data as { event_at: string } | null;
    if (lastRow) {
      const todayPht = phtDateString(new Date());
      const lastPht = phtDateString(new Date(lastRow.event_at));
      const a = new Date(`${todayPht}T00:00:00+08:00`).getTime();
      const b = new Date(`${lastPht}T00:00:00+08:00`).getTime();
      daysSince = Math.max(0, Math.floor((a - b) / 86_400_000));
    }
    return {
      liquidityBase: Math.max(0, liquidity),
      upcomingOutflows7dBase: upcoming,
      daysSinceLastPayment: daysSince,
    };
  } catch {
    return {
      liquidityBase: 0,
      upcomingOutflows7dBase: 0,
      daysSinceLastPayment: null,
    };
  }
}

export async function getSuggestedToday(): Promise<SuggestedToday> {
  const user = await getAuthUser();
  if (!user) return EMPTY_SUGGESTION;
  try {
    const pool = await readPoolBalance();
    const today = phtToday();
    const signals = await gatherSuggestedSignals(user.id);
    // Fingerprint includes the signals the brain reads. Period stage isn't
    // hashed yet; when the period engine lands it goes here so the 24h
    // cache invalidates when stage flips.
    const fingerprint = await fingerprintFromIds([
      user.id,
      today,
      String(Math.round(pool.displayBase)),
      String(Math.round(signals.liquidityBase)),
      String(Math.round(signals.upcomingOutflows7dBase)),
      String(signals.daysSinceLastPayment ?? "n"),
    ]);
    const cached = await withBrainCache<SuggestedToday>({
      brainKey: BRAIN_KEYS.SADAKA_SUGGESTED_TODAY,
      fingerprint,
      phtDayAnchored: true,
      regen: async () => {
        const result = await decideSadakaSuggestedToday({
          poolBase: pool.displayBase,
          liquidityBase: signals.liquidityBase,
          upcomingOutflows7dBase: signals.upcomingOutflows7dBase,
          daysSinceLastPayment: signals.daysSinceLastPayment,
        });
        return result;
      },
    });
    return cached?.payload ?? EMPTY_SUGGESTION;
  } catch {
    return EMPTY_SUGGESTION;
  }
}

// Compute "days since last given" against a PHT-day window. Pass in the
// event_at timestamp of the most recent payment/auto_detected row, get
// back the PHT-day delta. Async-typed because this lives inside a
// "use server" module — Next allows only async exports here. Internal
// callers in this file use the inline form below; external callers (the
// nudge dispatcher) await this entry point so the math stays consistent.
export async function daysSinceLastPaymentFromEvent(
  eventAt: string | null,
): Promise<number | null> {
  if (!eventAt) return null;
  const todayPht = phtDateString(new Date());
  const lastPht = phtDateString(new Date(eventAt));
  const a = new Date(`${todayPht}T00:00:00+08:00`).getTime();
  const b = new Date(`${lastPht}T00:00:00+08:00`).getTime();
  return Math.max(0, Math.floor((a - b) / 86_400_000));
}

// Last sadaka payment / auto_detected event date — drives the nudge
// silence-window check. Returns null when the user has never given.
export async function daysSinceLastPayment(): Promise<number | null> {
  const user = await getAuthUser();
  if (!user) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("sadaka_ledger")
      .select("event_at")
      .eq("user_id", user.id)
      .in("kind", ["payment", "auto_detected"])
      .is("archived_at", null)
      .order("event_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    return await daysSinceLastPaymentFromEvent(
      (data as { event_at: string }).event_at,
    );
  } catch {
    return null;
  }
}
