"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { phtDateString } from "@/lib/utils";
import { decideSadakaSuggestedToday } from "@/lib/ai/brains/sadaka-suggested-today";
import { getSadakaConfigForUser } from "./config";

// Freelane Sadaka — daily nudge dispatcher.
//
// Cron-invoked. For each active user:
//   1. Compute the pool balance.
//   2. Skip when liquidity is thin (cash on hand below 1.5× the suggested
//      amount, OR any wallet sitting in overdraft). The kind's contract is
//      "nudge only when the pool is sizeable AND liquidity is fine."
//   3. Ask the suggested-today brain with the gathered context bundle.
//   4. Honour the silence window (no nudge if a payment or auto_detected
//      event landed within the last N days).
//   5. Post a sadaka_nudge notification with linkUrl=/sadaka, dedupKey
//      'sadaka_nudge:<phtDay>' so a retry inside the same PHT day no-ops.
//
// Service client throughout — no session in cron.

async function postNudge(args: {
  userId: string;
  poolBase: number;
  suggested: number;
  reasoning: string;
  phtDay: string;
}): Promise<void> {
  const supabase = createServiceClient();
  // Dedup directly against notifications_inbox: cheaper than a round-trip
  // through postNotification (which is wired for the authed-user path).
  const dedupKey = `sadaka_nudge:${args.phtDay}`;
  const { data: existing } = await supabase
    .from("notifications_inbox")
    .select("id")
    .eq("user_id", args.userId)
    .eq("dedup_key", dedupKey)
    .limit(1);
  if ((existing ?? []).length > 0) return;
  await supabase.from("notifications_inbox").insert({
    user_id: args.userId,
    kind: "sadaka_nudge",
    subject: `Sadaka pool sits at ${Math.round(args.poolBase)}`,
    body: args.reasoning || `Suggested today: ${Math.round(args.suggested)}`,
    link_url: "/sadaka",
    dedup_key: dedupKey,
    priority: 1,
    payload: null,
  });
}

export async function maybeFireSadakaNudge(userId: string): Promise<{
  ok: boolean;
  skipped?:
    | "no_pool"
    | "no_suggestion"
    | "in_silence_window"
    | "already_today"
    | "low_liquidity";
}> {
  try {
    if (!userId) return { ok: false };
    const supabase = createServiceClient();

    // Config — silence days, via the canonical reader so cron and request
    // paths share defaults + clamping rules.
    const cfg = await getSadakaConfigForUser(userId);
    const silenceDays = Math.max(0, Math.floor(cfg.nudge_silence_days));

    // Pool balance from live ledger rows.
    const { data: rows } = await supabase
      .from("sadaka_ledger")
      .select("amount_base,kind,event_at")
      .eq("user_id", userId)
      .is("archived_at", null);
    const allRows = (rows ?? []) as Array<{
      amount_base: number | string;
      kind: string;
      event_at: string;
    }>;
    const rawSum = allRows.reduce((s, r) => s + Number(r.amount_base ?? 0), 0);
    const poolDisplay = Math.max(0, rawSum);
    if (!(poolDisplay > 0)) return { ok: true, skipped: "no_pool" };

    // Silence window — uses the shared PHT-day delta helper so the math
    // matches lib/sadaka/suggestion.ts's request-side reader.
    const lastGiven = allRows
      .filter((r) => r.kind === "payment" || r.kind === "auto_detected")
      .sort((a, b) => new Date(b.event_at).getTime() - new Date(a.event_at).getTime())[0];
    const { daysSinceLastPaymentFromEvent } = await import("./suggestion");
    const daysSinceLast = lastGiven
      ? await daysSinceLastPaymentFromEvent(lastGiven.event_at)
      : null;
    if (daysSinceLast !== null && daysSinceLast < silenceDays) {
      return { ok: true, skipped: "in_silence_window" };
    }

    // Liquidity gate — sum money_ledger live rows for the wallet base, plus
    // a per-wallet check for overdraft. Skip the nudge when liquidity is
    // thin: cash on hand below 1.5× a baseline expected suggestion (250 or
    // 1% of pool, whichever larger) OR any wallet sitting in overdraft.
    let liquidityBase = 0;
    let inOverdraft = false;
    try {
      const { data: ledgerRows } = await supabase
        .from("money_ledger")
        .select("amount_base,wallet_id")
        .eq("user_id", userId)
        .is("archived_at", null);
      const perWallet = new Map<string, number>();
      for (const r of ledgerRows ?? []) {
        const row = r as { amount_base: number | string; wallet_id: string | null };
        if (!row.wallet_id) continue;
        const cur = perWallet.get(row.wallet_id) ?? 0;
        perWallet.set(row.wallet_id, cur + Number(row.amount_base ?? 0));
      }
      for (const v of perWallet.values()) {
        liquidityBase += Math.max(0, v);
        if (v < 0) inOverdraft = true;
      }
    } catch {
      // If the ledger read fails, treat liquidity as unknown and skip the
      // nudge — better to miss one than fire when wallets are dry.
      return { ok: true, skipped: "low_liquidity" };
    }
    const liquidityFloor = Math.max(250, Math.round(poolDisplay * 0.01)) * 1.5;
    if (inOverdraft || liquidityBase < liquidityFloor) {
      return { ok: true, skipped: "low_liquidity" };
    }

    // Pull the brain's suggestion. No withBrainCache here — we're outside
    // the request path and write to ai_brain_cache that way would be a
    // cross-user smear. The brain is cheap enough to call once per user.
    const decision = await decideSadakaSuggestedToday({
      poolBase: poolDisplay,
      liquidityBase,
      daysSinceLastPayment: daysSinceLast,
    });
    if (!decision.surface_today || decision.suggested_amount <= 0) {
      return { ok: true, skipped: "no_suggestion" };
    }

    const phtDay = phtDateString(new Date());
    await postNudge({
      userId,
      poolBase: poolDisplay,
      suggested: decision.suggested_amount,
      reasoning: decision.reasoning,
      phtDay,
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
