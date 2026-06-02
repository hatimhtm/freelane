"use server";

// Plans-redesign server actions (migration 0088-0089).
//
// All actions return ActionResult<T> via safeRunLabeled so the UI can
// surface the underlying error. Next 16 masks thrown errors from server
// actions; the structured ok/error shape sidesteps that.
//
// Reads-and-writes that don't mutate the user's money state (price
// lookup, strategy proposals, decision support) live here; pure
// finance.planned_spends CRUD still lives in lib/data/actions.ts.

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { safeRunLabeled, type ActionResult } from "@/lib/data/actions";
import { invalidateBrainCache } from "@/lib/ai/cache";
import { BRAIN_KEYS } from "@/lib/ai/cache-keys";
import { scopedBrainKey } from "@/lib/ai/cache";
import {
  lookupPlanPrice,
  type PlanPriceLookupResult,
} from "@/lib/ai/brains/plan-price-lookup";
import {
  proposePlanStrategies,
  type PlanStrategyProposalsResult,
} from "@/lib/ai/brains/plan-strategy-proposals";
import {
  runPlanPurchaseDecisionSupport,
  type PlanPurchaseDecisionResult,
} from "@/lib/ai/brains/plan-purchase-decision-support";
import { postNotification } from "@/lib/notifications/dispatcher";
import { phtToday } from "@/lib/utils";
import { computeWalletBalancesFromLedger } from "@/lib/data/wallet-balance";
import { holdingBalances } from "@/lib/payment-chain";
import { computeSafeToSpendFromData } from "@/lib/safe-to-spend";
import { plannedInRange } from "@/lib/planned-spends";
import { getPlansData } from "@/lib/data/queries";

async function authedClient() {
  const supabase = await createClient();
  const user = await getAuthUser();
  if (!user) throw new Error("Unauthenticated");
  return { supabase, userId: user.id };
}

// ─────────────────────────── AI price lookup ──

export async function requestAiPriceLookup(
  planId: string,
): Promise<ActionResult<PlanPriceLookupResult>> {
  return safeRunLabeled("freelane-plan", "requestAiPriceLookup", async () => {
    const { supabase, userId } = await authedClient();
    const { data: plan } = await supabase
      .from("planned_spends")
      .select("label,price_source,expected_amount,expected_base,expected_currency")
      .eq("id", planId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!plan) throw new Error("Plan not found");
    const result = await lookupPlanPrice({
      planId,
      name: String(plan.label ?? ""),
    });
    // Persist AI-side metadata. Only overwrite expected_amount /
    // expected_base when the row is fresh enough (price_source === 'user'
    // AND expected_amount is 0). User-edited or adjusted prices stick.
    const isFreshUserDefault =
      (plan.price_source === "user" || plan.price_source == null) &&
      Number(plan.expected_amount ?? 0) === 0;
    const patch: Record<string, unknown> = {
      ai_price_range_low: result.range_low > 0 ? result.range_low : null,
      ai_price_range_high: result.range_high > 0 ? result.range_high : null,
      ai_price_sources: result.sources.length > 0 ? result.sources : null,
      ai_price_at: new Date().toISOString(),
    };
    if (isFreshUserDefault && result.range_high > 0) {
      const midpoint = Math.round((result.range_low + result.range_high) / 2);
      patch.expected_amount = midpoint;
      patch.expected_base = midpoint; // assumes PHP — the modal only allows PHP for AI fill
      patch.expected_currency = "PHP";
      patch.price_source = "ai";
    }
    await supabase
      .from("planned_spends")
      .update(patch)
      .eq("id", planId)
      .eq("user_id", userId);
    revalidatePath("/plans");
    return result;
  });
}

// ─────────────────────────── Strategies ──

function bucketHash(n: number, bucket: number): string {
  return String(Math.round(n / bucket) * bucket);
}

export async function proposeStrategies(
  planId: string,
): Promise<ActionResult<PlanStrategyProposalsResult>> {
  return safeRunLabeled("freelane-plan", "proposeStrategies", async () => {
    const { supabase, userId } = await authedClient();
    const { data: plan } = await supabase
      .from("planned_spends")
      .select("label,expected_base,target_date,justification")
      .eq("id", planId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!plan) throw new Error("Plan not found");

    const data = await getPlansData();
    const ledgerMap = await computeWalletBalancesFromLedger(data.methods).catch(
      () => new Map<string, { balance: number }>(),
    );
    const chainMap = new Map<string, number>();
    for (const [k, v] of ledgerMap) chainMap.set(k, v.balance);
    // Pass activePlanStrategies through so the brain sees the
    // POST-reduction reality. Otherwise "realism" is judged against a
    // fictional larger surplus that already counts the user's existing
    // commitments.
    const safe = computeSafeToSpendFromData(
      {
        payments: data.payments,
        withdrawals: data.withdrawals,
        spends: data.spends,
        recurring: data.recurring,
        recurringSkips: data.recurringSkips,
        loanInstallments: data.loanInstallments,
        methods: data.methods,
        stepsByPayment: data.stepsByPayment,
        rates: data.rates,
        plannedSpends: data.plannedSpends,
        ledgerBalances: chainMap,
        activePlanStrategies: data.activePlanStrategies,
      },
      new Date(),
    );
    const horizonEnd = new Date(Date.now() + 30 * 86_400_000);
    const others = data.plannedSpends.filter((p) => p.id !== planId);
    const plannedHorizon = plannedInRange(others, new Date(), horizonEnd).total;

    // Compute monthly eating-out + discretionary spend over the trailing
    // 30 days so the brain can ground monthly_save_estimate against
    // real baselines instead of inventing numbers. Categories whose
    // names match /eat|food|restaurant|cafe/i count as eating-out;
    // every spend (eating-out included) is part of discretionary.
    const thirtyDaysAgo = Date.now() - 30 * 86_400_000;
    const eatingOutCatIds = new Set<string>(
      data.spendCategories
        .filter((c) =>
          /eat|food|restaurant|cafe|dining|takeout/i.test(c.name ?? ""),
        )
        .map((c) => c.id),
    );
    let monthlyEatingOutBase = 0;
    let monthlyDiscretionaryBase = 0;
    for (const sp of data.spends) {
      const t = new Date(sp.spent_at).getTime();
      if (!(t >= thirtyDaysAgo)) continue;
      const amt = Number(sp.amount_base ?? 0);
      monthlyDiscretionaryBase += amt;
      // default_category_ids on a spend is not loaded here — the heuristic
      // matches against the spend description instead. Cheap fallback;
      // when getPlansData starts including spend_category_links the
      // condition can swap to the precise category-id check.
      const desc = (sp.description ?? "").toLowerCase();
      const matchesCat = Array.from(eatingOutCatIds).length > 0 && /eat|food|restaurant|cafe|dining|takeout|meal/i.test(desc);
      if (matchesCat) monthlyEatingOutBase += amt;
    }

    // Pool size feeds the channel_sadaka_overflow strategy's realism.
    let sadakaPoolBase = 0;
    try {
      const { readPoolBalance } = await import("@/lib/sadaka/ledger");
      const pool = await readPoolBalance();
      sadakaPoolBase = Number(pool?.displayBase ?? 0);
    } catch {
      // Pool optional.
    }

    // state_hash: bucket wallets/safe/horizon AND the inputs the brain
    // actually consults (eating-out baseline, sadaka pool). Without
    // them, a sadaka-pool drift would never bust the cache even though
    // channel_sadaka_overflow's realism depends on it.
    const stateHash = [
      bucketHash(safe.walletBalancesBase, 500),
      bucketHash(safe.safeTodayBase, 50),
      bucketHash(plannedHorizon, 500),
      bucketHash(monthlyEatingOutBase, 200),
      bucketHash(monthlyDiscretionaryBase, 500),
      bucketHash(sadakaPoolBase, 500),
    ].join(":");

    const proposals = await proposePlanStrategies({
      planId,
      plan: {
        label: String(plan.label ?? ""),
        expected_base: Number(plan.expected_base ?? 0),
        target_date: (plan.target_date as string | null) ?? null,
        justification: (plan.justification as string | null) ?? null,
      },
      walletBalanceBase: Math.round(safe.walletBalancesBase),
      dailySafeBase: Math.round(safe.safeTodayBase),
      plannedHorizonBase: Math.round(plannedHorizon),
      sadakaPoolBase: Math.round(sadakaPoolBase),
      spendingPatterns: {
        monthlyEatingOutBase: Math.round(monthlyEatingOutBase),
        monthlyDiscretionaryBase: Math.round(monthlyDiscretionaryBase),
      },
      stateHash,
    });

    // UPSERT the rank-1..3 strategies into finance.plan_strategies so
    // the detail sheet can render them with persistent activate state.
    // Drop any prior proposed rows for this plan that aren't active so
    // a regen doesn't accumulate stale options.
    await supabase
      .from("plan_strategies")
      .delete()
      .eq("user_id", userId)
      .eq("plan_id", planId)
      .eq("active", false);
    if (proposals.strategies.length > 0) {
      await supabase.from("plan_strategies").insert(
        proposals.strategies.map((s) => ({
          user_id: userId,
          plan_id: planId,
          strategy_kind: s.strategy_kind,
          rank: s.rank,
          title: s.title,
          // applicable_now lives on the dedicated column only — dual
          // storage in body.applicable_now drifted as one side was edited
          // without the other. Body is for free-shape strategy detail
          // (side_effects + future kind-specific payload).
          body: {
            side_effects: s.side_effects,
          },
          estimated_completion: s.estimated_completion,
          monthly_save_estimate: s.monthly_save_estimate,
          realism_score: s.realism_score,
          applicable_now: s.applicable_now,
          active: false,
          proposed_at: new Date().toISOString(),
        })),
      );
    }

    revalidatePath("/plans");
    return proposals;
  });
}

// Drops today's PHT-day daily_safe_snapshot row so the next render
// re-snapshots against the new strategy set. Without this, intra-day
// activate/deactivate changes are inert until midnight PHT — the
// snapshot for today was written earlier with the old strategy set and
// every downstream surface (Today, Dashboard, Spending) reads it as
// initialForToday.
async function invalidateTodayDailySafeSnapshot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<void> {
  try {
    await supabase
      .from("daily_safe_snapshots")
      .delete()
      .eq("user_id", userId)
      .eq("pht_date", phtToday());
  } catch {
    // Best-effort — snapshot tables regenerate on next read.
  }
}

export async function activateStrategy(
  strategyId: string,
): Promise<ActionResult<{ id: string }>> {
  return safeRunLabeled("freelane-plan", "activateStrategy", async () => {
    const { supabase, userId } = await authedClient();
    // Activation strategy:
    //   1. Try the partial unique index first by flipping the chosen
    //      row to active. If another active row already exists for
    //      this plan, the UNIQUE constraint rejects this step and we
    //      bail without touching anyone's state.
    //   2. Only after the new active row is in place do we deactivate
    //      the OTHER previously-active rows for the same plan.
    // This ordering means a mid-flow failure leaves the user with
    // EITHER the old active row OR the new one, never zero — the
    // previous order (deactivate-then-activate) could land at zero
    // active rows if the second UPDATE failed after the first
    // succeeded.
    const nowIso = new Date().toISOString();
    const { data: row } = await supabase
      .from("plan_strategies")
      .select("plan_id,active")
      .eq("id", strategyId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!row) throw new Error("Strategy not found");
    const planId = row.plan_id as string;
    // Step 1: activate the chosen row first. If another active row
    // already holds the unique-index slot, this either returns 0 rows
    // (no-op, depending on db) or the UNIQUE constraint rejects — we
    // detect both and deactivate-the-other-then-retry below.
    let activateError: { code?: string; message?: string } | null = null;
    {
      const { error } = await supabase
        .from("plan_strategies")
        .update({ active: true, activated_at: nowIso, deactivated_at: null })
        .eq("id", strategyId)
        .eq("user_id", userId);
      activateError = error as { code?: string; message?: string } | null;
    }
    // If the UNIQUE constraint kicked, deactivate the conflicting row
    // and try again. Postgres SQLSTATE 23505 = unique_violation.
    if (activateError) {
      const isUnique =
        activateError.code === "23505" ||
        /duplicate|unique/i.test(activateError.message ?? "");
      if (!isUnique) throw activateError;
      const deactivateOthers = await supabase
        .from("plan_strategies")
        .update({ active: false, deactivated_at: nowIso })
        .eq("user_id", userId)
        .eq("plan_id", planId)
        .eq("active", true)
        .neq("id", strategyId);
      if (deactivateOthers.error) throw deactivateOthers.error;
      const retry = await supabase
        .from("plan_strategies")
        .update({ active: true, activated_at: nowIso, deactivated_at: null })
        .eq("id", strategyId)
        .eq("user_id", userId);
      if (retry.error) throw retry.error;
    } else {
      // Step 2: deactivate any OTHER prior-active rows for this plan.
      // If this fails the unique index would have already prevented a
      // second active row from existing — we just have a stale row to
      // clean up next time.
      await supabase
        .from("plan_strategies")
        .update({ active: false, deactivated_at: nowIso })
        .eq("user_id", userId)
        .eq("plan_id", planId)
        .eq("active", true)
        .neq("id", strategyId);
    }
    // Strategy change affects daily safe — invalidate downstream brains.
    await invalidateBrainCache([
      scopedBrainKey(BRAIN_KEYS.PLAN_STRATEGY_PROPOSALS, "plan", planId),
    ]);
    // Intra-day correctness: today's snapshot was written before the
    // strategy flip — drop it so the next render re-snapshots with the
    // new reduction folded in. Without this, the headline number only
    // changes at the next PHT midnight rollover.
    await invalidateTodayDailySafeSnapshot(supabase, userId);
    revalidatePath("/plans");
    revalidatePath("/today");
    revalidatePath("/dashboard");
    revalidatePath("/spending");
    return { id: strategyId };
  });
}

export async function deactivateStrategy(
  strategyId: string,
): Promise<ActionResult<{ id: string }>> {
  return safeRunLabeled("freelane-plan", "deactivateStrategy", async () => {
    const { supabase, userId } = await authedClient();
    const { data: row } = await supabase
      .from("plan_strategies")
      .select("plan_id,active")
      .eq("id", strategyId)
      .eq("user_id", userId)
      .maybeSingle();
    // Skip the write entirely when the row is already inactive — the
    // audit trail (deactivated_at) should reflect the actual flip, not
    // a re-touch on an already-inactive strategy.
    if (!row || row.active !== true) {
      return { id: strategyId };
    }
    const { error } = await supabase
      .from("plan_strategies")
      .update({ active: false, deactivated_at: new Date().toISOString() })
      .eq("id", strategyId)
      .eq("user_id", userId)
      .eq("active", true);
    if (error) throw error;
    if (row?.plan_id) {
      await invalidateBrainCache([
        scopedBrainKey(BRAIN_KEYS.PLAN_STRATEGY_PROPOSALS, "plan", row.plan_id as string),
      ]);
    }
    // Same intra-day correctness rule as activate — today's snapshot
    // was written WITH the reduction; drop it so the headline rebounds
    // immediately rather than at midnight PHT.
    await invalidateTodayDailySafeSnapshot(supabase, userId);
    revalidatePath("/plans");
    revalidatePath("/today");
    revalidatePath("/dashboard");
    revalidatePath("/spending");
    return { id: strategyId };
  });
}

// ─────────────────────────── Decision support ──

export async function runDecisionSupport(
  planId: string,
): Promise<ActionResult<PlanPurchaseDecisionResult>> {
  return safeRunLabeled("freelane-plan", "runDecisionSupport", async () => {
    const { supabase, userId } = await authedClient();
    const { data: plan } = await supabase
      .from("planned_spends")
      .select("label,expected_base")
      .eq("id", planId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!plan) throw new Error("Plan not found");

    const data = await getPlansData();
    const ledgerMap = await computeWalletBalancesFromLedger(data.methods).catch(
      () => new Map<string, { balance: number }>(),
    );
    const chainMap = new Map<string, number>();
    for (const [k, v] of ledgerMap) chainMap.set(k, v.balance);
    const holdings = holdingBalances(
      data.methods,
      data.payments,
      data.stepsByPayment,
      data.withdrawals,
      data.spends,
      chainMap,
    );
    const walletTotalBase = holdings.reduce((s, h) => s + h.balance, 0);
    const safe = computeSafeToSpendFromData(
      {
        payments: data.payments,
        withdrawals: data.withdrawals,
        spends: data.spends,
        recurring: data.recurring,
        recurringSkips: data.recurringSkips,
        loanInstallments: data.loanInstallments,
        methods: data.methods,
        stepsByPayment: data.stepsByPayment,
        rates: data.rates,
        plannedSpends: data.plannedSpends,
        ledgerBalances: chainMap,
        activePlanStrategies: data.activePlanStrategies,
      },
      new Date(),
    );
    const horizonEnd = new Date(Date.now() + 30 * 86_400_000);
    const others = data.plannedSpends.filter((p) => p.id !== planId);
    const plannedHorizon = plannedInRange(others, new Date(), horizonEnd).total;

    // Generate a coarse pack-rhythm hint from the next 7 days of
    // payments + last 7 days of spend so pack_rhythm_fit isn't pure
    // speculation. "payment incoming" wins over "busy week" wins over
    // "light week" — first match short-circuits.
    const SEVEN = 7 * 86_400_000;
    const now = Date.now();
    const horizonStart = new Date(now);
    const horizonEndPack = new Date(now + SEVEN);
    const upcomingPayments = data.payments.filter((p) => {
      const t = new Date(p.paid_at).getTime();
      return t >= now && t <= horizonEndPack.getTime();
    });
    const recentSpendSum = data.spends.reduce((s, sp) => {
      const t = new Date(sp.spent_at).getTime();
      return t >= now - SEVEN && t <= now ? s + Number(sp.amount_base ?? 0) : s;
    }, 0);
    const last30dAvgWeeklySpend =
      data.spends.reduce((s, sp) => {
        const t = new Date(sp.spent_at).getTime();
        return t >= now - 30 * 86_400_000 ? s + Number(sp.amount_base ?? 0) : s;
      }, 0) /
      (30 / 7);
    const packRhythmHint =
      upcomingPayments.length > 0
        ? "payment incoming"
        : last30dAvgWeeklySpend > 0 && recentSpendSum > last30dAvgWeeklySpend * 1.2
          ? "busy week"
          : recentSpendSum < last30dAvgWeeklySpend * 0.7
            ? "light week"
            : "steady week";
    // Reference horizonStart to keep the symbol used (Lint).
    void horizonStart;

    const result = await runPlanPurchaseDecisionSupport({
      plan: {
        label: String(plan.label ?? ""),
        expected_base: Number(plan.expected_base ?? 0),
      },
      walletTotalBase,
      walletsByName: holdings.map((h) => ({ name: h.name, balanceBase: h.balance })),
      plannedHorizonBase: plannedHorizon,
      dailySafeBase: safe.safeTodayBase,
      packRhythmHint,
      periodStateHint: safe.inRecovery ? "recovery" : null,
    });
    return result;
  });
}

// ─────────────────────────── Plan field edits + lifecycle ──

export async function updatePlanJustification(
  planId: string,
  justification: string | null,
): Promise<ActionResult<{ id: string }>> {
  return safeRunLabeled("freelane-plan", "updatePlanJustification", async () => {
    const { supabase, userId } = await authedClient();
    const { error } = await supabase
      .from("planned_spends")
      .update({ justification: justification ?? null })
      .eq("id", planId)
      .eq("user_id", userId);
    if (error) throw error;
    revalidatePath("/plans");
    return { id: planId };
  });
}

export async function updatePlanTargetDate(
  planId: string,
  targetDate: string | null,
): Promise<ActionResult<{ id: string }>> {
  return safeRunLabeled("freelane-plan", "updatePlanTargetDate", async () => {
    const { supabase, userId } = await authedClient();
    const { error } = await supabase
      .from("planned_spends")
      .update({ target_date: targetDate ?? null })
      .eq("id", planId)
      .eq("user_id", userId);
    if (error) throw error;
    revalidatePath("/plans");
    return { id: planId };
  });
}

// NOTE: PHP-only by design. The plan UI does not currently expose a
// non-PHP price input (the modal hardcodes baseCurrency assuming PHP).
// If/when a multi-currency base ships, this action should accept
// currency + run toBaseAmount() like createPlannedSpend does. The
// runtime guard below protects against that drift.
export async function updatePlanPrice(
  planId: string,
  amountPhp: number,
): Promise<ActionResult<{ id: string }>> {
  return safeRunLabeled("freelane-plan", "updatePlanPrice", async () => {
    const { supabase, userId } = await authedClient();
    if (!(amountPhp >= 0)) throw new Error("Price must be 0 or greater");
    // Guard against a non-PHP base currency until the multi-currency
    // path is wired. The settings.base_currency read is cheap.
    const { data: settings } = await supabase
      .from("settings")
      .select("base_currency")
      .eq("user_id", userId)
      .maybeSingle();
    const baseCurrency = String(settings?.base_currency ?? "PHP");
    if (baseCurrency !== "PHP") {
      throw new Error(
        `updatePlanPrice currently assumes PHP base — got ${baseCurrency}. Use the spend-modal multi-currency flow.`,
      );
    }
    const rounded = Math.round(amountPhp);
    // Read the prior price so we can detect a meaningful change before
    // nuking strategies. A no-op save (e.g. blur with the same value)
    // should NOT deactivate an active strategy or wipe proposals.
    const { data: prior } = await supabase
      .from("planned_spends")
      .select("expected_base")
      .eq("id", planId)
      .eq("user_id", userId)
      .maybeSingle();
    const priorBase = Number(prior?.expected_base ?? 0);
    const { error } = await supabase
      .from("planned_spends")
      .update({
        expected_amount: rounded,
        expected_currency: "PHP",
        expected_base: rounded,
        price_source: "adjusted",
      })
      .eq("id", planId)
      .eq("user_id", userId);
    if (error) throw error;
    // Price-meaningful change ⇒ ALL strategies for this plan are stale.
    // monthly_save_estimate / realism_score were computed against the
    // OLD price, and any active strategy's daily-safe reduction would
    // keep trimming the wrong amount against a now-different plan.
    // Deactivate the active row + delete non-active proposals so the
    // detail sheet shows a fresh "Propose" button.
    const priceMaterial = Math.abs(rounded - priorBase) >= 1;
    if (priceMaterial) {
      try {
        await supabase
          .from("plan_strategies")
          .update({ active: false, deactivated_at: new Date().toISOString() })
          .eq("user_id", userId)
          .eq("plan_id", planId)
          .eq("active", true);
        await supabase
          .from("plan_strategies")
          .delete()
          .eq("user_id", userId)
          .eq("plan_id", planId)
          .eq("active", false);
      } catch {
        // Best-effort — the brain cache invalidation below will at
        // least force a re-propose on next render.
      }
    }
    // Strategy proposals are sensitive to price — bust the per-plan slot.
    await invalidateBrainCache([
      scopedBrainKey(BRAIN_KEYS.PLAN_STRATEGY_PROPOSALS, "plan", planId),
    ]);
    // The deactivation above also moves the live daily-safe — flush the
    // PHT-day snapshot so the headline reflects the new commitment set
    // immediately, not after midnight.
    if (priceMaterial) {
      await invalidateTodayDailySafeSnapshot(supabase, userId);
    }
    revalidatePath("/plans");
    revalidatePath("/today");
    revalidatePath("/dashboard");
    revalidatePath("/spending");
    return { id: planId };
  });
}

export async function archivePlan(
  planId: string,
): Promise<ActionResult<{ id: string }>> {
  return safeRunLabeled("freelane-plan", "archivePlan", async () => {
    const { supabase, userId } = await authedClient();
    const { error } = await supabase
      .from("planned_spends")
      .update({ status: "abandoned" })
      .eq("id", planId)
      .eq("user_id", userId);
    if (error) throw error;
    // Abandoning a plan MUST deactivate its active strategy — otherwise
    // the daily-safe reduction keeps trimming surplus forever (see also
    // markPlanBought in lib/data/actions.ts which does the same).
    try {
      await supabase
        .from("plan_strategies")
        .update({ active: false, deactivated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("plan_id", planId)
        .eq("active", true);
    } catch {
      // Best-effort.
    }
    await invalidateBrainCache([
      scopedBrainKey(BRAIN_KEYS.PLAN_STRATEGY_PROPOSALS, "plan", planId),
    ]);
    // Intra-day: today's daily_safe_snapshot was written with the
    // strategy still active — drop it so the headline rebounds today.
    await invalidateTodayDailySafeSnapshot(supabase, userId);
    revalidatePath("/plans");
    revalidatePath("/today");
    revalidatePath("/dashboard");
    revalidatePath("/spending");
    return { id: planId };
  });
}

export async function abandonPlan(
  planId: string,
): Promise<ActionResult<{ id: string }>> {
  return archivePlan(planId);
}

export async function confirmPlanBought(
  planId: string,
  overrides: { amount?: number; currency?: string; wallet_id?: string; spent_at?: string },
): Promise<ActionResult<{ id: string }>> {
  return safeRunLabeled("freelane-plan", "confirmPlanBought", async () => {
    const { supabase, userId } = await authedClient();
    const { data: plan } = await supabase
      .from("planned_spends")
      .select("label,expected_amount,expected_currency,wallet_id,notes,default_category_ids")
      .eq("id", planId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!plan) throw new Error("Plan not found");
    const walletId = overrides.wallet_id ?? (plan.wallet_id as string | null);
    if (!walletId) throw new Error("Pick a wallet before confirming.");
    const { markPlanBought } = await import("@/lib/data/actions");
    const result = await markPlanBought(planId, {
      amount: overrides.amount ?? Number(plan.expected_amount ?? 0),
      currency: overrides.currency ?? String(plan.expected_currency ?? "PHP"),
      wallet_id: walletId,
      spent_at: overrides.spent_at ?? phtToday(),
      description: String(plan.label ?? ""),
      notes: (plan.notes as string | null) ?? null,
      categoryIds: (plan.default_category_ids as string[] | null) ?? [],
    });
    if (!result.ok) throw new Error(result.error);
    // Schedule the +14d plan_satisfaction_check notification. Migration
    // 0090 added notifications_inbox.deliver_at so the row is written
    // NOW (dedup-locked) but stays out of the bell until the future
    // timestamp. The plan-satisfaction-check brain (Flash Lite) writes
    // the question_text + suggested_followups directly into the payload
    // here so the modal renders them as quick-tap chips without an
    // on-click round-trip.
    try {
      const deliverAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
      const { generatePlanSatisfactionPrompt } = await import(
        "@/lib/ai/brains/plan-satisfaction-check"
      );
      const prompt = await generatePlanSatisfactionPrompt({
        planId,
        name: String(plan.label),
        daysSinceBought: 14,
      }).catch(() => null);
      await postNotification({
        kind: "plan_satisfaction_check",
        subject: prompt?.question_text || `How is the ${plan.label} working out?`,
        body: "A quick 1-5 rating helps tune future plan picks.",
        dedupKey: `plan_satisfaction_check:${planId}`,
        linkUrl: `/plans?focus=${planId}`,
        payload: {
          kind_specific: {
            plan_id: planId,
            plan_label: String(plan.label),
            question_text: prompt?.question_text ?? null,
            suggested_followups: prompt?.suggested_followups ?? [],
          },
        },
        priority: 0,
        deliverAt,
      });
    } catch {
      // Best-effort.
    }
    return { id: result.data.id };
  });
}

export async function rateSatisfaction(
  planId: string,
  stars: number,
  note: string | null,
): Promise<ActionResult<{ id: string }>> {
  return safeRunLabeled("freelane-plan", "rateSatisfaction", async () => {
    const { supabase, userId } = await authedClient();
    const clamped = Math.max(1, Math.min(5, Math.round(stars)));
    const patch: Record<string, unknown> = {
      satisfaction_rating: clamped,
    };
    if (note != null && note.trim().length > 0) {
      // Migration 0090 — satisfaction_note is its own column so the
      // user's pre-existing implementation `notes` survive the rating
      // flow. Capped at 800 chars to match the previous behaviour.
      patch.satisfaction_note = note.trim().slice(0, 800);
    }
    const { error } = await supabase
      .from("planned_spends")
      .update(patch)
      .eq("id", planId)
      .eq("user_id", userId);
    if (error) throw error;
    revalidatePath("/plans");
    return { id: planId };
  });
}

// Reusable strategy-kind labels live in @/lib/plan-strategy-labels —
// pure constants module shared by the detail-sheet client component and
// any server reader without a server-action round-trip. The previous
// server-action wrapper here was dropped: it forced an RPC per call for
// a static map lookup and the label list was already duplicated client-
// side, so the "single source" justification was false.
