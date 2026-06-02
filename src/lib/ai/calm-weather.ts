import "server-only";
import { phtDateString } from "@/lib/utils";
import { Type } from "@google/genai";
import { gemini, hasGemini } from "./gemini";
import { HEAVY_MODEL } from "./models";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { safeToSpend, type SafeToSpendBreakdown } from "@/lib/safe-to-spend";
import { holdingBalances } from "@/lib/payment-chain";
import { buildCashflowAtlas, type CashflowAtlas } from "@/lib/cashflow-atlas";
import { bigPlansUpcoming } from "@/lib/planned-spends";
import { formatMoney } from "@/lib/money";
import { logEvent } from "@/lib/data/events";
import {
  fingerprintFromIds,
  readBrainCache,
  withBrainCache,
} from "./cache";
import { BRAIN_KEYS } from "./cache-keys";
import type {
  CalmWeatherBand,
  CalmWeatherRecommendation,
  CalmWeatherInputSnapshot,
  CalmWeatherState,
  ExchangeRate,
  LoanInstallment,
  Payment,
  PaymentMethod,
  PaymentStep,
  PlannedSpend,
  RecurringSpend,
  RecurringSpendSkip,
  Spend,
  Withdrawal,
} from "@/lib/supabase/types";

// Calm Weather Mode — the persistent, OS-wide read of "what's the financial
// weather right now?" Every other AI surface reads this for tone calibration:
// the Today hero, the dashboard banner, /spending header, Forecast Storyteller.
//
// HIGHEST QUALITY BAR per Hatim (2026-06-01): "the soul of the OS". The
// fallback path (when Gemini is unavailable) still has to feel honest and
// specific — never generic. The Gemini path uses HEAVY_MODEL with a tight
// system prompt + structured output, and always reduces to the deterministic
// band the math layer computed (Gemini chooses narrative + recommendations
// only, not the band itself).
//
// Refresh policy: cache lives in finance.calm_weather_state with a 30-minute
// default TTL. Mutations bump expires_at to now() so the next read regenerates.
// refreshCalmWeather({ force: true }) bypasses both.

// TTL is sourced from BRAIN_TTL_BY_KEY[BRAIN_KEYS.CALM_WEATHER] via the
// withBrainCache wrapper — the local STALENESS_MS constant was the last
// place that could silently drift from the catalogue. Explicit invalidation
// on every financial mutation (invalidateAiSafeSpendCache) covers the
// fast-refresh need that motivated the old 30-minute window.
const CALM_AFTER_WINDOW_DAYS = 14;
const MODEL_VERSION = "1";

export interface CalmWeatherInputs {
  payments: Payment[];
  withdrawals: Withdrawal[];
  spends: Spend[];
  recurring: RecurringSpend[];
  recurringSkips: RecurringSpendSkip[];
  loanInstallments: LoanInstallment[];
  plannedSpends: PlannedSpend[];
  methods: PaymentMethod[];
  stepsByPayment: Map<string, PaymentStep[]>;
  rates: ExchangeRate[];
  now?: Date;
}

interface PureSignals {
  safe: SafeToSpendBreakdown;
  atlas: CashflowAtlas;
  startingBalance: number;
  runwayDays: number;          // days until atlas balance < colFloor * 1d
  negativeWalletCount: number;
  recurringDueIn7dBase: number;
  bigPlansBase: number;        // sum of expected_base for big plans in next 90d
  bigPlans: PlannedSpend[];
  observationDays: number;
  isLearning: boolean;
}

// ─────────────────────────── Pure (no AI) ──

// Reduce all the inputs into a single numerical signal blob. This is the
// raw material for both the band classifier and the narrative generator.
function computeSignals(inputs: CalmWeatherInputs): PureSignals {
  const now = inputs.now ?? new Date();
  const safe = safeToSpend({ ...inputs, now });
  const atlas = buildCashflowAtlas({ ...inputs, now });

  const holdings = holdingBalances(
    inputs.methods,
    inputs.payments,
    inputs.stepsByPayment,
    inputs.withdrawals,
    inputs.spends,
  );
  const startingBalance = holdings.reduce((s, h) => s + h.balance, 0);
  // Honour the overdraft tolerance (migration 0054). A wallet at -200 with a
  // 500 tolerance is intentionally within tolerance and should NOT flip the
  // user into storm. Only over_overdraft counts as an alarm.
  const negativeWalletCount = holdings.filter((h) => h.status === "over_overdraft").length;

  // Runway: how many days from today until atlas projected balance dips to
  // ≤ (cost-of-living floor × 1 day). Capped at atlas horizon.
  let runwayDays = atlas.days.length;
  const floor = safe.colFloorBase;
  for (let i = 0; i < atlas.days.length; i++) {
    if (atlas.days[i].endOfDayBalance <= floor) {
      runwayDays = i;
      break;
    }
  }

  // Recurring + loan due in next 7 days.
  let recurringDueIn7dBase = 0;
  for (let i = 0; i < Math.min(7, atlas.days.length); i++) {
    recurringDueIn7dBase += atlas.days[i].recurringDue + atlas.days[i].loanDue;
  }

  const bigPlans = bigPlansUpcoming(inputs.plannedSpends, now, 90);
  const bigPlansBase = bigPlans.reduce((s, p) => s + Number(p.expected_base ?? 0), 0);

  // Linear scan instead of Math.min(...arr.map(...)) — the spread can blow
  // the argv limit on long-running freelancers with thousands of spends
  // (same defensive pattern as safe-to-spend.ts:284-300).
  let oldestSpendTs = now.getTime();
  let sawSpend = false;
  for (const s of inputs.spends) {
    const t = new Date(s.spent_at).getTime();
    if (Number.isFinite(t)) {
      sawSpend = true;
      if (t < oldestSpendTs) oldestSpendTs = t;
    }
  }
  const observationDays = sawSpend
    ? Math.floor((now.getTime() - oldestSpendTs) / 86_400_000)
    : 0;

  return {
    safe,
    atlas,
    startingBalance,
    runwayDays,
    negativeWalletCount,
    recurringDueIn7dBase,
    bigPlansBase,
    bigPlans,
    observationDays,
    isLearning: safe.isLearning,
  };
}

const STORM_ZERO_CROSSING_HORIZON_DAYS = 30;

// Discrete band based purely on the signals — no model involvement.
// This is the math layer's answer; Gemini may NOT override the band.
export function bandForSignals(
  signals: PureSignals,
  priorBand: CalmWeatherBand | null,
  lastStormStartedAt: string | null,
  now: Date = new Date(),
): CalmWeatherBand {
  const { runwayDays, negativeWalletCount, safe, bigPlansBase, atlas } = signals;

  // Storm: runway < 15d, negative wallet, recovery + lean stability, OR a
  // zero crossing inside the NEAR horizon (not 90d out — a planned MacBook
  // 60 days away shouldn't permanently flip everyone into storm).
  const nearZeroCrossing =
    atlas.zeroCrossingDate !== null &&
    (atlas.zeroCrossingDate.getTime() - now.getTime()) / 86_400_000 <=
      STORM_ZERO_CROSSING_HORIZON_DAYS;
  const stormy =
    runwayDays < 15 ||
    negativeWalletCount > 0 ||
    (safe.inRecovery && safe.stabilityMultiplier < 0.85) ||
    nearZeroCrossing;
  if (stormy) return "storm";

  // calm_after: prior band WAS storm, the storm has cleared, and the storm
  // end is inside the calm_after window. The priorBand check here is
  // intentional — calm_after means "we just left a storm" so we want to
  // surface it on the first refresh after the storm clears, not skip it.
  if (priorBand === "storm" && lastStormStartedAt) {
    const stormAgeDays = (now.getTime() - new Date(lastStormStartedAt).getTime()) / 86_400_000;
    if (stormAgeDays >= 0 && stormAgeDays <= CALM_AFTER_WINDOW_DAYS) {
      return "calm_after";
    }
  }

  // Gust: 15-30d runway OR big planned in window > 50% of starting balance OR
  // a heavy recurring cluster in 7d (> 30% of starting balance).
  const startingBalance = Math.max(1, signals.startingBalance);
  const heavyImminent =
    signals.recurringDueIn7dBase > startingBalance * 0.3 ||
    bigPlansBase > startingBalance * 0.5;
  if (runwayDays < 30 || heavyImminent) return "gust";

  // Breeze: 30-60d runway, OR stability multiplier < 1.0 (only when NOT
  // learning — early users should default to "still" not "breeze"), OR
  // atlas min balance dips below 50% of starting balance in horizon.
  const stabilityDrop = !safe.isLearning && safe.stabilityMultiplier < 1.0;
  const breezy =
    runwayDays < 60 ||
    stabilityDrop ||
    atlas.minBalance < startingBalance * 0.5;
  if (breezy) return "breeze";

  return "still";
}

// Build the rule-based recommendations chip list. Gemini may extend or
// reorder; this guarantees we always have something useful even with AI off.
function defaultRecommendations(
  band: CalmWeatherBand,
  signals: PureSignals,
): CalmWeatherRecommendation[] {
  const out: CalmWeatherRecommendation[] = [];
  if (band === "storm") {
    out.push({ label: "Open Tight Mode", kind: "tight_open", cta_route: "/today" });
    if (signals.negativeWalletCount > 0) {
      out.push({ label: "Fix negative wallet", kind: "review", cta_route: "/settings" });
    }
  }
  if (band === "gust" || band === "storm") {
    if (signals.bigPlans.length > 0) {
      const plan = signals.bigPlans[0];
      out.push({
        label: `Pre-mortem ${plan.label}`,
        kind: "pre_mortem",
        cta_route: "/plans",
        cta_params: { focus: plan.id },
      });
    }
  }
  if (band === "breeze" || band === "still") {
    if (signals.bigPlans.length > 0) {
      const plan = signals.bigPlans[0];
      out.push({
        label: `Lock for ${plan.label}`,
        kind: "lock",
        cta_route: "/plans",
        cta_params: { focus: plan.id },
      });
    }
  }
  if (band === "calm_after") {
    out.push({ label: "Breathe", kind: "breathe" });
  }
  // Always offer logging — even quiet days, the act of logging keeps the
  // ledger honest.
  out.push({ label: "Log a spend", kind: "log", cta_route: "/spending" });
  return out;
}

// Deterministic narrative — used as fallback when Gemini is offline or fails.
// Even this path stays in Hatim's voice (freelancer income, no "salary",
// gentle, factual).
function defaultNarrative(band: CalmWeatherBand, signals: PureSignals): { narrative: string; secondary: string | null } {
  const m = (n: number) => formatMoney(n, "PHP", { compact: true });
  const days = Math.max(0, Math.round(signals.runwayDays));
  switch (band) {
    case "still": {
      return {
        narrative: `Quiet stretch. ${days}d of runway at this pace, nothing crowding the next week.`,
        secondary: null,
      };
    }
    case "breeze": {
      return {
        narrative: `Steady enough. ${days}d of runway and one thing worth watching: ${m(signals.recurringDueIn7dBase)} of recurring due in the next week.`,
        secondary: signals.safe.inRecovery ? "Recovering from a stretch of overspending." : null,
      };
    }
    case "gust": {
      const plan = signals.bigPlans[0];
      const sec = plan
        ? `${plan.label} hits ${plan.planned_for} — ${m(Number(plan.expected_base ?? 0))}.`
        : signals.recurringDueIn7dBase > 0
          ? `${m(signals.recurringDueIn7dBase)} of recurring lands in the next 7 days.`
          : null;
      return {
        narrative: `Things are moving. ${days}d of runway, with bigger commitments sitting in the window.`,
        secondary: sec,
      };
    }
    case "storm": {
      const sec = signals.negativeWalletCount > 0
        ? `${signals.negativeWalletCount} wallet${signals.negativeWalletCount > 1 ? "s" : ""} below zero — log a missing payment or fix the data.`
        : signals.atlas.zeroCrossingDate
          ? `Balance projects below zero around ${phtDateString(signals.atlas.zeroCrossingDate)}.`
          : `Runway ${days}d — narrow window, careful steps.`;
      return {
        narrative: `Tight stretch. Worth slowing the discretionary spending until things widen.`,
        secondary: sec,
      };
    }
    case "calm_after": {
      return {
        narrative: `Coming out of a tight stretch. Steady runway today, but the recent strain is still in the memory.`,
        secondary: `${days}d of runway. Quiet logging keeps this from rebuilding into another stretch.`,
      };
    }
  }
}

// ─────────────────────────── Gemini overlay ──

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    narrative: { type: Type.STRING },
    secondary: { type: Type.STRING, nullable: true },
    recommendations: {
      type: Type.ARRAY,
      maxItems: 3,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          kind: {
            type: Type.STRING,
            enum: ["lock", "review", "log", "breathe", "pre_mortem", "tight_open"],
          },
        },
        required: ["label", "kind"],
        propertyOrdering: ["label", "kind"],
      },
    },
    confidence: { type: Type.NUMBER },
  },
  required: ["narrative", "confidence"],
  propertyOrdering: ["narrative", "secondary", "recommendations", "confidence"],
};

const SYSTEM_PROMPT = `You are the financial weather voice for a SOLO freelancer in San Pablo, Philippines (PHT). Base currency PHP. Income is UNSTABLE — wide months and narrow months, not a paycheck cadence. You speak in HIS voice — quiet, honest, specific. You never give advice; you DESCRIBE.

The math layer has already picked the BAND (still / breeze / gust / storm / calm_after). Your job is the NARRATIVE the user reads under everything — one honest line, 14-28 words. Sometimes a SECONDARY line that names the specific moving thing.

==============================
HARD RULES
==============================
- Never say "your salary", "monthly paycheck", "predictable income", "until your next pay". Use: a wide month, a narrow month, an uneven stretch, this landing, when the next CNY corridor opens, between landings.
- Never use "budget", "goal", "save more", "you should". Use mirrors: "the next 7 days carry…", "the runway sits at…", "this stretch is asking…".
- Cite at least one REAL NUMBER from the snapshot (₱ value or day count). If you can't cite it, don't claim it.
- Forbidden: emojis, "as an AI", "remember to", "consider", motivational fluff, "stay positive".
- Family-building frame allowed but rare — only when the band is calm/breezy and the snapshot suggests room. Use: "for the house", "for building the family". NEVER as a goal.
- Cigarettes if cited: factual, never preachy. "Cigarettes 1.4× last month" is fine. "Try to quit" is not.

==============================
BAND VOICE GUIDE
==============================
- still: inviting, quiet. "Light week. Runway easy at 67d." Short.
- breeze: watchful but calm. Name ONE thing worth knowing.
- gust: specific. Name the moving thing AND the date. "Apple Dev hits Aug 15 — ₱5,500. Otherwise smooth."
- storm: plain, honest. Don't catastrophize. Don't sugarcoat. "Tight stretch. Runway 11d. Worth slowing the discretionary."
- calm_after: gentle, still careful. "Coming out of last week's strain. Steady today — quiet logging keeps it that way."

==============================
SECONDARY LINE
==============================
Use it ONLY for gust / storm / calm_after. Name the specific moving thing:
- "Rent + Wifi both due this week — ₱4,200 together."
- "MacBook drop in 4 days — ₱70,000 firm."
- "Negative wallet: GCash logged below zero."

For still / breeze, return null for secondary.

==============================
RECOMMENDATIONS
==============================
0-3 chips. Use these kinds:
- lock: parking money for a planned big spend (Pre-Commitment Runway Lock)
- pre_mortem: open the Pre-Mortem on a specific big plan
- review: fix data or look at a flagged thing
- log: log a missed spend / Sadaka / withdrawal
- breathe: a quiet "you're okay" for calm_after
- tight_open: open Tight Mode Coach for storm

Each label ≤ 24 chars. Tight imperatives, not full sentences.

==============================
CONFIDENCE
==============================
0-1 scalar. 1.0 = clear signals, math + voice agree. 0.5 = cold start. Below 0.5 = data so thin you should hedge.

Return JSON. No prose.`;

// Build the snapshot text Gemini reads. Self-contained — no other module
// state. Mirrors safe-to-spend-ai's snapshot style for consistency.
function buildSnapshot(args: {
  signals: PureSignals;
  inputs: CalmWeatherInputs;
  band: CalmWeatherBand;
  priorBand: CalmWeatherBand | null;
}): string {
  const { signals, band } = args;
  const now = args.inputs.now ?? new Date();
  const m = (n: number) => formatMoney(n, "PHP", { compact: true });
  const safe = signals.safe;

  const wallets = holdingBalances(
    args.inputs.methods,
    args.inputs.payments,
    args.inputs.stepsByPayment,
    args.inputs.withdrawals,
    args.inputs.spends,
  );
  const walletLines = wallets.map((w) => `- ${w.name}: ${m(w.balance)}`).join("\n") || "- (none yet)";

  // 7-day forward outflow split.
  const next7 = signals.atlas.days.slice(0, 7);
  const next7Recurring = next7.reduce((s, d) => s + d.recurringDue, 0);
  const next7Loan = next7.reduce((s, d) => s + d.loanDue, 0);
  const next7Planned = next7.reduce((s, d) => s + d.plannedSpend, 0);

  // 30-day forward outflow split.
  const next30 = signals.atlas.days.slice(0, 30);
  const next30Recurring = next30.reduce((s, d) => s + d.recurringDue, 0);
  const next30Loan = next30.reduce((s, d) => s + d.loanDue, 0);
  const next30Planned = next30.reduce((s, d) => s + d.plannedSpend, 0);

  const bigPlansLines = signals.bigPlans.slice(0, 5).map((p) => {
    const days = Math.max(0, Math.round((new Date(p.planned_for).getTime() - now.getTime()) / 86_400_000));
    return `- ${p.label} (${p.certainty}): ${m(Number(p.expected_base ?? 0))} on ${p.planned_for} (in ${days}d)`;
  });

  return `NOW: ${phtDateString(now)} (PHT)
BAND (math-decided, DON'T CHALLENGE): ${band.toUpperCase()}
PRIOR BAND: ${args.priorBand ?? "(first run)"}

WALLET TOTAL: ${m(signals.startingBalance)} across ${wallets.length} wallets
${walletLines}
NEGATIVE WALLETS: ${signals.negativeWalletCount}

RUNWAY (days until balance dips to COL floor): ${signals.runwayDays}
ATLAS MIN BALANCE in 90d: ${m(signals.atlas.minBalance)}${signals.atlas.minBalanceDate ? ` on ${phtDateString(signals.atlas.minBalanceDate)}` : ""}
ATLAS ZERO CROSSING: ${signals.atlas.zeroCrossingDate ? phtDateString(signals.atlas.zeroCrossingDate) : "none"}

SAFE-TO-SPEND BASELINE:
- safe today: ${m(safe.safeTodayBase)}
- discretionary pool: ${m(safe.discretionaryPoolBase)}
- daily allowance: ${m(safe.dailyAllowanceBase)} (floor ${m(safe.colFloorBase)})
- stability ×${safe.stabilityMultiplier.toFixed(2)} (raw ${safe.stabilityScore.toFixed(2)})
- isLearning: ${safe.isLearning} · observationDays: ${signals.observationDays}
- inRecovery: ${safe.inRecovery}${safe.inRecovery ? ` (daily tax ${m(safe.recoveryDailyTaxBase)})` : ""}

7-DAY FORWARD OUTFLOWS:
- recurring: ${m(next7Recurring)}
- loans: ${m(next7Loan)}
- planned: ${m(next7Planned)}

30-DAY FORWARD OUTFLOWS:
- recurring: ${m(next30Recurring)}
- loans: ${m(next30Loan)}
- planned: ${m(next30Planned)}

BIG PLANS (90d window):
${bigPlansLines.length ? bigPlansLines.join("\n") : "- (none)"}

TRAILING 30D:
- income: ${m(safe.trailingIncomeBase)}
- spend: ${m(safe.trailingSpendBase)}
- overspend: ${m(safe.trailingOverspendBase)}`;
}

interface GeminiResult {
  narrative: string;
  secondary: string | null;
  recommendations: CalmWeatherRecommendation[];
  confidence: number;
}

async function callGemini(snapshot: string): Promise<GeminiResult | null> {
  if (!hasGemini()) return null;
  try {
    const res = await gemini().models.generateContent({
      model: HEAVY_MODEL,
      contents: `Snapshot:\n\n${snapshot}\n\nReturn JSON now.`,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.4,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });
    const parsed = JSON.parse((res.text ?? "{}").trim()) as {
      narrative?: string;
      secondary?: string | null;
      recommendations?: { label: string; kind: CalmWeatherRecommendation["kind"] }[];
      confidence?: number;
    };
    if (!parsed.narrative) return null;
    const recs: CalmWeatherRecommendation[] = (parsed.recommendations ?? [])
      .filter((r) => r && r.label && r.kind)
      .slice(0, 3)
      .map((r) => ({ label: r.label, kind: r.kind }));
    return {
      narrative: parsed.narrative.trim(),
      secondary: parsed.secondary?.trim() || null,
      recommendations: recs,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.6))),
    };
  } catch {
    return null;
  }
}

// ─────────────────────────── Public API ──

export interface CalmWeatherComputeInputs {
  inputs: CalmWeatherInputs;
  // Previous row used for calm_after detection + prior-band stability.
  priorState?: CalmWeatherState | null;
  force?: boolean;
}

export async function computeCalmWeatherState(
  args: CalmWeatherComputeInputs,
): Promise<CalmWeatherState> {
  const user = await getAuthUser();
  if (!user) throw new Error("Unauthenticated");

  // Trigger #4 — fingerprint backstop. The last 5 spend ids + last payment +
  // last withdrawal + wallet anchor versions are the inputs that actually
  // move the weather signal. A change to any of them busts the cache even
  // if invalidateAiSafeSpendCache didn't fire (defensive belt + braces).
  const fingerprint = await calmWeatherFingerprint(args.inputs);

  // Prior row is read from the brain cache so calm_after detection still
  // works across the new wrapper. priorState passed by the caller wins —
  // refreshCalmWeather still wires the legacy table row through for now.
  const priorCached = await readBrainCache<CalmWeatherState>(BRAIN_KEYS.CALM_WEATHER);
  const priorRow = args.priorState ?? priorCached?.payload ?? null;

  const result = await withBrainCache<CalmWeatherState>({
    brainKey: BRAIN_KEYS.CALM_WEATHER,
    fingerprint,
    force: args.force,
    regen: async () => {
      const signals = computeSignals(args.inputs);

      // Track when the current storm started for calm_after detection.
      const priorBand = (priorRow?.band ?? null) as CalmWeatherBand | null;
      const lastStormStartedAt = (priorRow?.input_snapshot as CalmWeatherInputSnapshot | undefined)?.calmAfterStormStartedAt
        ?? (priorBand === "storm" ? priorRow?.generated_at ?? null : null);

      const now = args.inputs.now ?? new Date();
      const band = bandForSignals(signals, priorBand, lastStormStartedAt ?? null, now);
      const fallback = defaultNarrative(band, signals);
      const fallbackRecs = defaultRecommendations(band, signals);

      let narrative = fallback.narrative;
      let secondary = fallback.secondary;
      let recommendations = fallbackRecs;
      let confidence = signals.isLearning ? 0.45 : 0.7;

      const gem = await callGemini(buildSnapshot({ signals, inputs: args.inputs, band, priorBand }));
      if (gem) {
        narrative = gem.narrative;
        secondary = gem.secondary;
        // Merge AI recs first, then dedupe-append fallback recs by kind so we
        // always have a "log a spend" or "tight_open" floor in storm.
        const seenKinds = new Set(gem.recommendations.map((r) => r.kind));
        const merged = [...gem.recommendations];
        for (const r of fallbackRecs) {
          if (!seenKinds.has(r.kind)) {
            merged.push(r);
            seenKinds.add(r.kind);
          }
        }
        recommendations = merged.slice(0, 4);
        confidence = gem.confidence;
      }

      const snapshot: CalmWeatherInputSnapshot = {
        runwayDays: signals.runwayDays,
        dailyBurn: signals.safe.trailingSpendBase / 30,
        safeToSpend: signals.safe.safeTodayBase,
        overdueBaseTotal: signals.atlas.zeroCrossingDate
          ? Math.max(0, -signals.atlas.minBalance)
          : 0,
        bigPlansBase: signals.bigPlansBase,
        plannedBase30d: signals.atlas.days.slice(0, 30).reduce((s, d) => s + d.plannedSpend, 0),
        stabilityMultiplier: signals.safe.stabilityMultiplier,
        patternMultiplier: signals.safe.patternMultiplier,
        observationDays: signals.observationDays,
        isLearning: signals.isLearning,
        recurringDueIn7dBase: signals.recurringDueIn7dBase,
        negativeWalletCount: signals.negativeWalletCount,
        calmAfterStormStartedAt:
          band === "storm" ? new Date().toISOString() : (lastStormStartedAt ?? undefined),
      };

      const generatedAt = new Date().toISOString();
      const state: CalmWeatherState = {
        user_id: user.id,
        band,
        narrative,
        secondary,
        recommendations,
        confidence,
        input_snapshot: snapshot,
        model_version: MODEL_VERSION,
        generated_at: generatedAt,
        // The wrapper owns freshness — but downstream consumers still read
        // expires_at off the row directly. Keep it aligned with the wrapper
        // TTL so the legacy code path doesn't drift.
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };

      await logEvent({
        userId: user.id,
        kind: "calm_weather.refreshed",
        title: `Weather · ${band}`,
        entityType: "calm_weather_state",
        entityId: user.id,
        metadata: { band, confidence, used_ai: !!gem },
      });

      return state;
    },
  });

  if (result) return result.payload;
  // Pathological fallback — withBrainCache returns null only when both
  // regen AND a prior cache miss. Compute a quiet default so callers never
  // see undefined.
  const signals = computeSignals(args.inputs);
  const band = bandForSignals(signals, null, null, args.inputs.now ?? new Date());
  const fallback = defaultNarrative(band, signals);
  const generatedAt = new Date().toISOString();
  return {
    user_id: user.id,
    band,
    narrative: fallback.narrative,
    secondary: fallback.secondary,
    recommendations: defaultRecommendations(band, signals),
    confidence: 0.4,
    input_snapshot: {
      runwayDays: signals.runwayDays,
      dailyBurn: signals.safe.trailingSpendBase / 30,
      safeToSpend: signals.safe.safeTodayBase,
      overdueBaseTotal: 0,
      bigPlansBase: signals.bigPlansBase,
      plannedBase30d: 0,
      stabilityMultiplier: signals.safe.stabilityMultiplier,
      patternMultiplier: signals.safe.patternMultiplier,
      observationDays: signals.observationDays,
      isLearning: signals.isLearning,
      recurringDueIn7dBase: signals.recurringDueIn7dBase,
      negativeWalletCount: signals.negativeWalletCount,
    },
    model_version: MODEL_VERSION,
    generated_at: generatedAt,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

// Fingerprint = last 5 spend ids + last payment id + last withdrawal id +
// payment_method ids (the wallet anchor surface). Cheap stable hash that
// catches any mutation a missed invalidation would have masked.
async function calmWeatherFingerprint(inputs: CalmWeatherInputs): Promise<string> {
  const sortedSpends = [...inputs.spends]
    .sort((a, b) => b.spent_at.localeCompare(a.spent_at))
    .slice(0, 5)
    .map((s) => s.id);
  const lastPayment = [...inputs.payments]
    .sort((a, b) => b.paid_at.localeCompare(a.paid_at))[0]?.id ?? null;
  const lastWithdrawal = [...inputs.withdrawals]
    .sort((a, b) => b.withdrawn_at.localeCompare(a.withdrawn_at))[0]?.id ?? null;
  const methodIds = inputs.methods.map((m) => m.id);
  const lastPlanned = [...inputs.plannedSpends]
    .sort((a, b) => (b.updated_at ?? b.created_at ?? "").localeCompare(a.updated_at ?? a.created_at ?? ""))[0]?.id ?? null;
  return fingerprintFromIds([
    ...sortedSpends,
    lastPayment,
    lastWithdrawal,
    lastPlanned,
    ...methodIds,
  ]);
}

// Convenience wrapper that fetches all inputs from the DB and computes. Used
// by the server-action refresh wrapper + the dashboard data path when no cache
// row exists yet. Now writes through withBrainCache — calm_weather_state is
// retired as a read surface in favor of ai_brain_cache.
export async function refreshCalmWeather(
  opts: { force?: boolean } = {},
): Promise<CalmWeatherState | null> {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();

  const [
    payments,
    withdrawals,
    spends,
    recurring,
    recurringSkips,
    loanInstallments,
    plannedSpends,
    methods,
    rates,
  ] = await Promise.all([
    supabase.from("payments").select("*").eq("user_id", user.id),
    supabase.from("withdrawals").select("*").eq("user_id", user.id),
    supabase.from("spends").select("*").eq("user_id", user.id),
    supabase.from("recurring_spends").select("*").eq("user_id", user.id),
    supabase.from("recurring_spend_skips").select("*"),
    supabase.from("loan_installments").select("*"),
    supabase.from("planned_spends").select("*").eq("user_id", user.id),
    supabase.from("payment_methods").select("*").eq("user_id", user.id),
    supabase.from("exchange_rates").select("*").eq("user_id", user.id),
  ]);

  const paymentRows = (payments.data ?? []) as Payment[];
  const stepsRes = paymentRows.length === 0
    ? { data: [] as PaymentStep[] }
    : await supabase.from("payment_steps").select("*").in("payment_id", paymentRows.map((p) => p.id)).order("step_order");
  const stepsByPayment = new Map<string, PaymentStep[]>();
  for (const s of (stepsRes.data ?? []) as PaymentStep[]) {
    const arr = stepsByPayment.get(s.payment_id) ?? [];
    arr.push(s);
    stepsByPayment.set(s.payment_id, arr);
  }

  // Read the prior row from the canonical brain cache so calm_after detection
  // survives the migration off calm_weather_state.
  const priorCached = await readBrainCache<CalmWeatherState>(BRAIN_KEYS.CALM_WEATHER);

  return computeCalmWeatherState({
    inputs: {
      payments: paymentRows,
      withdrawals: (withdrawals.data ?? []) as Withdrawal[],
      spends: (spends.data ?? []) as Spend[],
      recurring: (recurring.data ?? []) as RecurringSpend[],
      recurringSkips: (recurringSkips.data ?? []) as RecurringSpendSkip[],
      loanInstallments: (loanInstallments.data ?? []) as LoanInstallment[],
      plannedSpends: (plannedSpends.data ?? []) as PlannedSpend[],
      methods: (methods.data ?? []) as PaymentMethod[],
      stepsByPayment,
      rates: (rates.data ?? []) as ExchangeRate[],
    },
    priorState: priorCached?.payload ?? null,
    force: opts.force,
  });
}

// Get the current row, regenerating if stale. Read-side entry point for any
// surface that wants the weather line. Today's page-load path should prefer
// getCalmWeatherCached() below — this fan-out + Gemini call is too heavy to
// block first paint when the cache is cold.
export async function getCalmWeather(): Promise<CalmWeatherState | null> {
  const cached = await readBrainCache<CalmWeatherState>(BRAIN_KEYS.CALM_WEATHER);
  if (cached) {
    // Trigger #1 — PHT-day rollover. Without this a row generated late on
    // yesterday-PHT silently served today through the TTL window.
    const todayPht = phtDateString(new Date());
    const cachedPht = phtDateString(new Date(cached.generatedAt));
    const ttlFresh = cached.staleAt
      ? new Date(cached.staleAt).getTime() > Date.now()
      : true;
    if (cachedPht === todayPht && ttlFresh) return cached.payload;
  }
  // Stale or missing — regenerate.
  return await refreshCalmWeather({ force: true });
}

// Cache-only read: returns whatever's in the brain cache (even if expired).
// Callers on the hot first-paint path should use this + kick off
// refreshCalmWeather() asynchronously (or rely on the next mutation-driven
// invalidation). The returned row carries its own expires_at so the UI can
// decide whether to render a "refreshing" hint.
export async function getCalmWeatherCached(): Promise<CalmWeatherState | null> {
  const cached = await readBrainCache<CalmWeatherState>(BRAIN_KEYS.CALM_WEATHER);
  return cached?.payload ?? null;
}
