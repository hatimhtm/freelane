import "server-only";
import { Type } from "@google/genai";
import { gemini, MODEL, hasGemini } from "./gemini";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import {
  safeToSpend,
  suggestSadakaForIncome,
  type SafeToSpendBreakdown,
  type SafeToSpendInputs,
} from "@/lib/safe-to-spend";
import { spendsByCategoryInRange } from "@/lib/dashboard-calc";
import { linksBySpend } from "@/lib/spends";
import { loansWithBalance } from "@/lib/loans";
import { anchorDate } from "@/lib/recurring";
import { holdingBalances } from "@/lib/payment-chain";
import { formatMoney, toBase } from "@/lib/money";
import { PH_COL_CONTEXT } from "@/lib/ph-col";
import type {
  CurrencyCode,
  Loan,
  LoanInstallment,
  SpendCategory,
  SpendCategoryLink,
  UserMemoryConsolidated,
} from "@/lib/supabase/types";

const CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
const TRAILING_LOOKBACK_DAYS = 30;
const RECENT_NOTES_LIMIT = 12;
const RECENT_SPENDS_LIMIT = 20;
const FORWARD_HORIZON_DAYS = 30;
const INCOME_HISTORY_WEEKS = 8;
const TOP_CATEGORIES = 8;

export type SafeToSpendVerdict = "comfortable" | "watchful" | "tight" | "lean";
export type SafeToSpendTrajectory = "improving" | "stable" | "worsening";
export type WatchoutKind = "anomaly" | "pace" | "recurring" | "trajectory";

export interface SafeToSpendWatchout {
  title: string;
  detail: string;
  kind: WatchoutKind;
}

export interface SafeToSpendOverlay {
  safeTodayBase: number;
  ruleBasedBase: number;
  patternMultiplier: number;
  verdict: SafeToSpendVerdict;
  oneLineReasoning: string;
  watchouts: SafeToSpendWatchout[];
  trajectory: SafeToSpendTrajectory;
  sadakaSuggestionBase: number | null;
  isLearning: boolean;
  fromCache: boolean;
  generatedAt: string;
  baseline: SafeToSpendBreakdown;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    patternMultiplier: { type: Type.NUMBER },
    verdict: { type: Type.STRING, enum: ["comfortable", "watchful", "tight", "lean"] },
    oneLineReasoning: { type: Type.STRING },
    watchouts: {
      type: Type.ARRAY,
      maxItems: 3,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          detail: { type: Type.STRING },
          kind: { type: Type.STRING, enum: ["anomaly", "pace", "recurring", "trajectory"] },
        },
        required: ["title", "detail", "kind"],
        propertyOrdering: ["title", "detail", "kind"],
      },
    },
    trajectory: { type: Type.STRING, enum: ["improving", "stable", "worsening"] },
    sadakaSuggestionBase: { type: Type.NUMBER, nullable: true },
  },
  required: ["patternMultiplier", "verdict", "oneLineReasoning", "watchouts", "trajectory"],
  propertyOrdering: ["patternMultiplier", "verdict", "oneLineReasoning", "watchouts", "trajectory", "sadakaSuggestionBase"],
};

const SYSTEM_PROMPT = `You are the personal money analyst for a SOLO freelancer in the Philippines. Base currency PHP. You see EVERYTHING about their money: wallet balances across multiple holding wallets, last 30 days of spending with tags + notes, every recurring expectation due in the next 30 days, every loan they owe or are owed, trailing income velocity, recovery state if they've overspent recently, and the user's running pattern memory.

Your single job: produce a NUANCED overlay on a rule-based safe-to-spend number. The rule-based formula already did the math; you re-rank it based on observed behavior + the user's broader situation.

==============================
WHAT YOU DECIDE
==============================
1. patternMultiplier ∈ [0.7, 1.2] — applied to the rule-based daily allowance. Lean toward LOWER when:
   - Recovery mode is active and behavior suggests deeper trouble (frequent overspending categories)
   - Trailing spends show just-after-payday bursts
   - A category is drifting badly above the user's typical baseline (cite a number)
   - Imminent large loan installment or recurring expense
   Lean toward HIGHER when:
   - Income velocity is steady and surplus is real
   - Trailing 30d spend already below normal
   - No imminent commitments
   - User is on a long streak of in-budget weeks

   Default to 1.0 if signals are mixed.

2. verdict: comfortable | watchful | tight | lean
   - comfortable: surplus, no nearby commitments
   - watchful: surplus but a category drift or upcoming commitment
   - tight: discretionary close to commitments, careful spending needed
   - lean: recovery mode or commitments crowding essentials

3. oneLineReasoning: ≤ 18 words. Imperative or diagnostic. No filler. Cite at least one real number.

4. watchouts: 0-3 concrete observations. Each:
   - title: ≤ 8 words
   - detail: ≤ 18 words, cites a real number from the snapshot
   - kind: anomaly | pace | recurring | trajectory

   Good: "Cigarettes 40% above your typical month" / detail / anomaly
   Bad: "Watch your spending" (vague), "Consider saving" (preachy), any without a real number

5. trajectory: improving | stable | worsening — 30d direction.

6. sadakaSuggestionBase: ONLY if justLandedNetBase > 0 in input. Otherwise null. Suggest 2-5% scaled to stability, lower in recovery, never below 1.5%.

==============================
HARD RULES
==============================
- Use the snapshot's REAL numbers. NEVER invent figures. If you can't cite it, don't claim it.
- Cap patternMultiplier at [0.7, 1.2]. NEVER override the rule-based number outside that range — the formula is the safety net, you're the tuner.
- If isLearning is true OR less than 3 weeks of spending data exists: patternMultiplier = 1.0, verdict = "watchful", surface a watchout that says you're still calibrating.
- Respect the PH cost-of-living floor — NEVER suggest cutting essentials.
- Recovery must be GENTLE. Even in deep overspend, never suggest brutal cuts — the formula's spread is already doing that work.
- Plain, warm, sharp. No "as an AI". No disclaimers. No tax advice. No therapy.

==============================
PH COST-OF-LIVING PRIORS
==============================
${PH_COL_CONTEXT}

Return ONLY the JSON object. No prose.`;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function deriveTrajectory(score: number): SafeToSpendTrajectory {
  if (score > 1.1) return "improving";
  if (score < 0.9) return "worsening";
  return "stable";
}

export function fallbackOverlay(
  baseline: SafeToSpendBreakdown,
  justLandedNetBase?: number,
  inputs?: SafeToSpendInputs,
): SafeToSpendOverlay {
  const horizonDailyDiscretionary =
    baseline.horizonDays > 0 ? baseline.discretionaryPoolBase / baseline.horizonDays : 0;

  let verdict: SafeToSpendVerdict;
  if (baseline.inRecovery || baseline.dailyAllowanceBase < baseline.colFloorBase * 1.5) {
    verdict = "lean";
  } else if (horizonDailyDiscretionary < baseline.colFloorBase * 2) {
    verdict = "tight";
  } else if (baseline.stabilityMultiplier < 1.0) {
    verdict = "watchful";
  } else {
    verdict = "comfortable";
  }

  const reasoning =
    `Discretionary ₱${Math.round(baseline.discretionaryPoolBase)} across ${baseline.horizonDays}d; ` +
    `stability ×${baseline.stabilityMultiplier.toFixed(2)}.`;

  let sadakaSuggestionBase: number | null = null;
  if (justLandedNetBase && justLandedNetBase > 0 && inputs) {
    sadakaSuggestionBase = suggestSadakaForIncome(justLandedNetBase, inputs).suggestedBase;
  }

  return {
    safeTodayBase: baseline.safeTodayBase,
    ruleBasedBase: baseline.safeTodayBase,
    patternMultiplier: 1.0,
    verdict,
    oneLineReasoning: reasoning,
    watchouts: [],
    trajectory: deriveTrajectory(baseline.stabilityScore),
    sadakaSuggestionBase,
    isLearning: baseline.isLearning,
    fromCache: false,
    generatedAt: new Date().toISOString(),
    baseline,
  };
}

function fallbackWithNote(
  baseline: SafeToSpendBreakdown,
  noteTitle: string,
  noteDetail: string,
  justLandedNetBase?: number,
  inputs?: SafeToSpendInputs,
): SafeToSpendOverlay {
  const overlay = fallbackOverlay(baseline, justLandedNetBase, inputs);
  overlay.watchouts = [{ title: noteTitle, detail: noteDetail, kind: "trajectory" }];
  return overlay;
}

function buildSnapshot(args: {
  inputs: SafeToSpendInputs;
  baseline: SafeToSpendBreakdown;
  spendCategories: SpendCategory[];
  spendCategoryLinks: SpendCategoryLink[];
  loans: Loan[];
  loanInstallments: LoanInstallment[];
  userMemory?: UserMemoryConsolidated;
  justLandedNetBase?: number;
}): string {
  const now = args.inputs.now ?? new Date();
  const horizonEnd = new Date(now.getTime() + FORWARD_HORIZON_DAYS * DAY_MS);
  const lookbackStart = new Date(now.getTime() - TRAILING_LOOKBACK_DAYS * DAY_MS);
  const currency: CurrencyCode = "PHP";
  const m = (n: number) => formatMoney(n, currency, { compact: true });

  const holdings = holdingBalances(
    args.inputs.methods,
    args.inputs.payments,
    args.inputs.stepsByPayment,
    args.inputs.withdrawals,
    args.inputs.spends,
  );

  const categoryById = new Map(args.spendCategories.map((c) => [c.id, c]));
  const links = linksBySpend(args.spendCategoryLinks);
  const catTotals = spendsByCategoryInRange(args.inputs.spends, links, lookbackStart, now)
    .slice(0, TOP_CATEGORIES)
    .map((r) => `- ${categoryById.get(r.categoryId)?.name ?? "untagged"}: ${m(r.total)}`);

  const recentSpends = args.inputs.spends
    .filter((s) => {
      const d = new Date(s.spent_at);
      return d >= lookbackStart && d <= now;
    })
    .sort((a, b) => new Date(b.spent_at).getTime() - new Date(a.spent_at).getTime())
    .slice(0, RECENT_SPENDS_LIMIT);

  const noteLines = recentSpends
    .filter((s) => s.description || s.notes)
    .slice(0, RECENT_NOTES_LIMIT)
    .map((s) => {
      const parts = [s.description, s.notes].filter(Boolean).join(" — ");
      const tags = (links.get(s.id) ?? [])
        .map((id) => categoryById.get(id)?.name)
        .filter(Boolean)
        .join(", ");
      return `- ${s.spent_at.slice(0, 10)} ${m(Number(s.amount_base ?? 0))}${tags ? ` [${tags}]` : ""}: ${parts}`;
    });

  // pendingRecurringNow only returns rules in the current OPEN window, so rules whose
  // next anchor sits 10-30 days out would be dropped. Enumerate directly: current
  // anchor if still ahead, else step one period forward and re-anchor.
  const forwardRecurring = args.inputs.recurring
    .filter((r) => r.active)
    .map((r) => {
      const expectedBase = toBase(
        Number(r.expected_amount),
        r.expected_currency as CurrencyCode,
        args.inputs.rates,
      );
      let anchor = anchorDate(r, now);
      anchor.setHours(0, 0, 0, 0);
      if (anchor.getTime() < now.getTime()) {
        let refDate: Date;
        switch (r.schedule_kind) {
          case "monthly":
            refDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            break;
          case "every_n_months": {
            const n = r.every_n_value ?? 1;
            refDate = new Date(now.getFullYear(), now.getMonth() + n, 1);
            break;
          }
          case "half_monthly":
            refDate =
              now.getDate() <= 15
                ? new Date(now.getFullYear(), now.getMonth(), 16)
                : new Date(now.getFullYear(), now.getMonth() + 1, 1);
            break;
          case "weekly":
            refDate = new Date(now.getTime() + 7 * DAY_MS);
            break;
          case "yearly":
            refDate = new Date(now.getFullYear() + 1, 0, 1);
            break;
        }
        anchor = anchorDate(r, refDate);
        anchor.setHours(0, 0, 0, 0);
      }
      if (anchor < now || anchor > horizonEnd) return null;
      const days = Math.round((anchor.getTime() - now.getTime()) / DAY_MS);
      return `- ${r.label}: ${m(expectedBase)} on ${anchor.toISOString().slice(0, 10)} (in ${days}d)`;
    })
    .filter(Boolean);

  const lwb = loansWithBalance(args.loans, args.loanInstallments, args.inputs.spends, now);
  const loansLines = lwb
    .filter((l) => l.loan.direction === "borrowed" && l.derivedStatus !== "closed")
    .map((l) => {
      const nextDue = l.upcoming[0];
      const next = nextDue
        ? ` · next ${nextDue.due_date}: ${m(toBase(Number(nextDue.expected_amount), nextDue.expected_currency as CurrencyCode, args.inputs.rates))}`
        : "";
      const overdue = l.overdue.length ? ` · ${l.overdue.length} overdue` : "";
      return `- ${l.loan.counterparty}: balance ${m(l.balanceBase)}${next}${overdue}`;
    });

  const weekStart = new Date(now.getTime() - INCOME_HISTORY_WEEKS * 7 * DAY_MS);
  const incomeByWeek = new Map<string, number>();
  for (const p of args.inputs.payments) {
    const d = new Date(p.paid_at);
    if (d < weekStart || d > now) continue;
    const weeksAgo = Math.floor((now.getTime() - d.getTime()) / (7 * DAY_MS));
    const key = `wk-${weeksAgo}`;
    incomeByWeek.set(key, (incomeByWeek.get(key) ?? 0) + Number(p.net_amount_base ?? 0));
  }
  const incomeLines: string[] = [];
  for (let i = 0; i < INCOME_HISTORY_WEEKS; i++) {
    const total = incomeByWeek.get(`wk-${i}`) ?? 0;
    incomeLines.push(`- ${i === 0 ? "this week" : `${i}w ago`}: ${m(total)}`);
  }

  const memBits = args.userMemory
    ? [
        args.userMemory.summary,
        ...(args.userMemory.patterns ?? []).map((p) => `pattern: ${p}`),
        ...(args.userMemory.watch ?? []).map((w) => `watch: ${w}`),
        ...(args.userMemory.milestones ?? []).map((ms) => `milestone: ${ms}`),
      ].filter(Boolean).join("\n- ")
    : "";

  const b = args.baseline;
  return `NOW: ${now.toISOString()}
JUST LANDED: ${args.justLandedNetBase && args.justLandedNetBase > 0 ? m(args.justLandedNetBase) : "n/a"}

RULE-BASED BASELINE (horizon ${b.horizonDays}d):
- safeTodayBase (rule-based): ${m(b.safeTodayBase)}
- dailyAllowanceRaw: ${m(b.dailyAllowanceBase)} (COL floor ${m(b.colFloorBase)})
- discretionaryPool: ${m(b.discretionaryPoolBase)}
- walletBalances: ${m(b.walletBalancesBase)}
- forwardIncomeProjection: ${m(b.forwardIncomeProjectionBase)}
- committedPool: ${m(b.committedPoolBase)} (recurring ${m(b.recurringForwardBase)} + loans ${m(b.loanForwardBase)} + feeFloor ${m(b.feeFloorBase)})
- trailingIncome 30d: ${m(b.trailingIncomeBase)}
- trailingSpend 30d: ${m(b.trailingSpendBase)}
- stabilityScore: ${b.stabilityScore.toFixed(2)} (multiplier ×${b.stabilityMultiplier.toFixed(2)})
- isLearning: ${b.isLearning}
- inRecovery: ${b.inRecovery}${b.inRecovery ? ` (daily tax ${m(b.recoveryDailyTaxBase)})` : ""}

WALLETS:
${holdings.length ? holdings.map((h) => `- ${h.name}: ${m(h.balance)}`).join("\n") : "- none"}

TRAILING 30D SPENDING by category:
${catTotals.join("\n") || "- none"}

TRAILING 30D NOTES (most recent):
${noteLines.join("\n") || "- none"}

RECURRING DUE NEXT 30D:
${forwardRecurring.join("\n") || "- none"}

LOANS OWED:
${loansLines.join("\n") || "- none"}

INCOME RECENT (last ${INCOME_HISTORY_WEEKS} weeks):
${incomeLines.join("\n")}

USER MEMORY:
${memBits ? `- ${memBits}` : "- (none yet)"}`;
}

export async function computeSafeToSpendInsight(args: {
  inputs: SafeToSpendInputs;
  userMemory?: UserMemoryConsolidated;
  spendCategories: SpendCategory[];
  spendCategoryLinks: SpendCategoryLink[];
  loans: Loan[];
  loanInstallments: LoanInstallment[];
  justLandedNetBase?: number;
  force?: boolean;
}): Promise<SafeToSpendOverlay> {
  const baseline = safeToSpend(args.inputs);

  const user = await getAuthUser();
  if (!user) {
    return fallbackWithNote(
      baseline,
      "Not signed in",
      "Showing rule-based baseline only.",
      args.justLandedNetBase,
      args.inputs,
    );
  }
  const supabase = await createClient();

  if (!args.force) {
    const { data } = await supabase
      .from("ai_safe_spend_cache")
      .select("insight,generated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (data?.generated_at) {
      const age = Date.now() - new Date(data.generated_at as string).getTime();
      if (age < CACHE_TTL_MS && data.insight) {
        const cached = data.insight as Partial<SafeToSpendOverlay>;
        return {
          ...fallbackOverlay(baseline, args.justLandedNetBase, args.inputs),
          ...cached,
          baseline,
          fromCache: true,
          generatedAt: data.generated_at as string,
        };
      }
    }
  }

  if (!hasGemini()) {
    return fallbackWithNote(
      baseline,
      "AI offline",
      "Gemini not configured — showing rule-based safe-to-spend only.",
      args.justLandedNetBase,
      args.inputs,
    );
  }

  const snapshot = buildSnapshot({
    inputs: args.inputs,
    baseline,
    spendCategories: args.spendCategories,
    spendCategoryLinks: args.spendCategoryLinks,
    loans: args.loans,
    loanInstallments: args.loanInstallments,
    userMemory: args.userMemory,
    justLandedNetBase: args.justLandedNetBase,
  });

  try {
    const res = await gemini().models.generateContent({
      model: MODEL,
      contents: `Snapshot:\n\n${snapshot}\n\nReturn the JSON object now.`,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.3,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });
    const parsed = JSON.parse((res.text ?? "{}").trim()) as {
      patternMultiplier?: number;
      verdict?: SafeToSpendVerdict;
      oneLineReasoning?: string;
      watchouts?: SafeToSpendWatchout[];
      trajectory?: SafeToSpendTrajectory;
      sadakaSuggestionBase?: number | null;
    };

    let patternMultiplier = clamp(Number(parsed.patternMultiplier ?? 1), 0.7, 1.2);
    let verdict: SafeToSpendVerdict = parsed.verdict ?? "watchful";
    let watchouts: SafeToSpendWatchout[] = (parsed.watchouts ?? []).slice(0, 3);

    const observationDays = args.inputs.spends.length
      ? Math.floor(
          (Date.now() -
            Math.min(...args.inputs.spends.map((s) => new Date(s.spent_at).getTime()))) /
            DAY_MS,
        )
      : 0;
    if (baseline.isLearning || observationDays < 21) {
      patternMultiplier = 1.0;
      verdict = "watchful";
      const calibrating: SafeToSpendWatchout = {
        title: "Still calibrating",
        detail: `AI overlay is learning — ${observationDays} days of spending data so far.`,
        kind: "trajectory",
      };
      watchouts = [calibrating, ...watchouts].slice(0, 3);
    }

    const surplus = Math.max(0, baseline.dailyAllowanceBase - baseline.colFloorBase);
    // Mirrors safe-to-spend.ts: colFloor + surplus * stabilityMultiplier * patternMultiplier. patternMultiplier replaces the v1 placeholder of 1.0.
    const safeTodayBase =
      baseline.colFloorBase + surplus * patternMultiplier * baseline.stabilityMultiplier;

    let sadakaSuggestionBase: number | null = null;
    if (args.justLandedNetBase && args.justLandedNetBase > 0) {
      const aiSuggestion = parsed.sadakaSuggestionBase;
      if (typeof aiSuggestion === "number" && aiSuggestion >= 0) {
        const minAllowed = args.justLandedNetBase * 0.015;
        const maxAllowed = args.justLandedNetBase * 0.05;
        sadakaSuggestionBase = Math.round(clamp(aiSuggestion, minAllowed, maxAllowed));
      } else {
        sadakaSuggestionBase = suggestSadakaForIncome(
          args.justLandedNetBase,
          args.inputs,
        ).suggestedBase;
      }
    }

    const overlay: SafeToSpendOverlay = {
      safeTodayBase,
      ruleBasedBase: baseline.safeTodayBase,
      patternMultiplier,
      verdict,
      oneLineReasoning: parsed.oneLineReasoning ?? "",
      watchouts,
      trajectory: parsed.trajectory ?? deriveTrajectory(baseline.stabilityScore),
      sadakaSuggestionBase,
      isLearning: baseline.isLearning,
      fromCache: false,
      generatedAt: new Date().toISOString(),
      baseline,
    };

    await supabase
      .from("ai_safe_spend_cache")
      .upsert(
        { user_id: user.id, insight: overlay, generated_at: overlay.generatedAt },
        { onConflict: "user_id" },
      );

    return overlay;
  } catch {
    return fallbackWithNote(
      baseline,
      "AI offline",
      "Gemini call failed — showing rule-based safe-to-spend only.",
      args.justLandedNetBase,
      args.inputs,
    );
  }
}

export async function invalidateSafeSpendCacheForUser(userId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("ai_safe_spend_cache").delete().eq("user_id", userId);
}
