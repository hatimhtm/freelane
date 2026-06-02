import "server-only";

import { Type } from "@google/genai";
import { gemini, hasGemini, pickModel } from "../models";
import { scrubForbiddenPhrases } from "../voice-scrub";

// Pro brain — plan_purchase_decision_support.
//
// Runs at the moment the user taps "Mark as bought" on a plan. Soft check
// only — the user can confirm anyway. Renders a modal with: per-wallet
// before/after, period impact, pack rhythm fit, AI recommendation,
// alternative wallet routes.
//
// FRESH each invocation — NO cache wrapper. The whole point of this brain
// is a snapshot at decision time; cached output would be misleading.
// The BRAIN_KEYS.PLAN_PURCHASE_DECISION entry exists in the catalog for
// invalidation parity (TTL = 0 by convention).

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    wallet_impact_rows: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          source: { type: Type.STRING }, // 'total' or wallet name
          before: { type: Type.NUMBER },
          after: { type: Type.NUMBER },
          negative_flag: { type: Type.BOOLEAN },
        },
        required: ["source", "before", "after", "negative_flag"],
      },
    },
    period_impact_note: { type: Type.STRING },
    pack_rhythm_fit: { type: Type.STRING },
    recommendation: {
      type: Type.STRING,
      enum: ["go", "pause", "reroute"],
    },
    alternatives: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    headline: { type: Type.STRING },
  },
  required: [
    "wallet_impact_rows",
    "period_impact_note",
    "pack_rhythm_fit",
    "recommendation",
    "alternatives",
    "headline",
  ],
} as const;

const SYSTEM_PROMPT = `You produce a SOFT CHECK at the moment a purchase is about to be made.

Voice: observational, plain, brief. The user is about to confirm or cancel.
Help them see the impact in one glance. No coaching, no "are you sure".

Hard rules:
- wallet_impact_rows: start with one row source="total" (sum of all
  wallets), then 0-3 per-wallet rows representing the routes considered
  (wallet name, before, after, negative_flag = after < 0).
  All values PHP whole numbers.
- period_impact_note: ONE short sentence about recovery / period stage
  impact. ≤ 18 words.
- pack_rhythm_fit: ONE short sentence about the surrounding week
  (light week / busy week / payment incoming / …). ≤ 14 words.
- recommendation: "go" | "pause" | "reroute". Lowercase exactly.
- alternatives: 0-3 short strings, each a wallet route option
  (e.g. "Pull from Wise — leaves ₱50"). ≤ 60 chars each.
- headline: ONE flat phrase summarizing the situation in ≤ 60 chars.
- NEVER use: "you should", "consider", "save more", "stay positive",
  "well done", "great job", "amazing"

Return ONLY {
  "wallet_impact_rows": [...],
  "period_impact_note": string,
  "pack_rhythm_fit": string,
  "recommendation": string,
  "alternatives": string[],
  "headline": string
} JSON.`;

export type WalletImpactRow = {
  source: string;
  before: number;
  after: number;
  negative_flag: boolean;
};

export type PlanPurchaseDecisionInput = {
  plan: { label: string; expected_base: number };
  walletTotalBase: number;
  walletsByName: Array<{ name: string; balanceBase: number }>;
  plannedHorizonBase: number;
  dailySafeBase: number;
  packRhythmHint?: string | null;
  periodStateHint?: string | null;
};

export type PlanPurchaseDecisionResult = {
  wallet_impact_rows: WalletImpactRow[];
  period_impact_note: string;
  pack_rhythm_fit: string;
  recommendation: "go" | "pause" | "reroute";
  alternatives: string[];
  headline: string;
};

function fallbackResult(input: PlanPurchaseDecisionInput): PlanPurchaseDecisionResult {
  const after = input.walletTotalBase - input.plan.expected_base;
  return {
    wallet_impact_rows: [
      {
        source: "total",
        before: Math.round(input.walletTotalBase),
        after: Math.round(after),
        negative_flag: after < 0,
      },
    ],
    period_impact_note: "",
    pack_rhythm_fit: "",
    recommendation: after < 0 ? "pause" : "go",
    alternatives: [],
    headline: "",
  };
}

export async function runPlanPurchaseDecisionSupport(
  input: PlanPurchaseDecisionInput,
): Promise<PlanPurchaseDecisionResult> {
  if (!hasGemini()) return fallbackResult(input);
  try {
    const lines: string[] = [
      `PURCHASE: ${input.plan.label}`,
      `PRICE (PHP): ${Math.round(input.plan.expected_base)}`,
      `WALLET TOTAL: ${Math.round(input.walletTotalBase)}`,
      "WALLETS:",
      ...input.walletsByName
        .slice(0, 6)
        .map((w) => `- ${w.name}: ${Math.round(w.balanceBase)}`),
      `DAILY SAFE: ${Math.round(input.dailySafeBase)}`,
      `OTHER PLANNED SPENDS IN WINDOW: ${Math.round(input.plannedHorizonBase)}`,
      input.packRhythmHint ? `PACK RHYTHM: ${input.packRhythmHint}` : null,
      input.periodStateHint ? `PERIOD STATE: ${input.periodStateHint}` : null,
      "",
      "Produce the soft check. Return JSON.",
    ].filter(Boolean) as string[];

    const res = await gemini().models.generateContent({
      model: pickModel("heavy"),
      contents: lines.join("\n"),
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.3,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });
    const parsed = JSON.parse((res.text ?? "{}").trim()) as Partial<PlanPurchaseDecisionResult>;
    // Build a set of allowed source labels so hallucinated wallet rows
    // get filtered. 'total' is always allowed; wallet names must match
    // one the caller passed in (case-insensitive, trimmed).
    const allowedSources = new Set<string>(["total"]);
    for (const w of input.walletsByName) {
      allowedSources.add(w.name.trim().toLowerCase());
    }
    const rows = (parsed.wallet_impact_rows ?? [])
      .filter((r) => r && typeof r.source === "string")
      .map((r) => ({
        source: String(r.source).slice(0, 60),
        before: Math.round(Number(r.before) || 0),
        after: Math.round(Number(r.after) || 0),
        negative_flag: !!r.negative_flag,
      }))
      .filter((r) => allowedSources.has(r.source.trim().toLowerCase()))
      .slice(0, 4);
    // recommendation: trim + lowercase + strict enum check. Defaults to
    // 'pause' on overdrawn rather than 'go' so a parse miss errs on
    // the safer side instead of silently green-lighting.
    const recRaw = String(parsed.recommendation ?? "")
      .trim()
      .toLowerCase()
      .replace(/[.!]+$/, "");
    const rec: PlanPurchaseDecisionResult["recommendation"] =
      recRaw === "go" || recRaw === "pause" || recRaw === "reroute"
        ? recRaw
        : input.walletTotalBase < input.plan.expected_base
          ? "pause"
          : "go";
    return {
      wallet_impact_rows:
        rows.length > 0 ? rows : fallbackResult(input).wallet_impact_rows,
      period_impact_note: scrubForbiddenPhrases(
        String(parsed.period_impact_note ?? "").trim(),
      ).slice(0, 180),
      pack_rhythm_fit: scrubForbiddenPhrases(
        String(parsed.pack_rhythm_fit ?? "").trim(),
      ).slice(0, 120),
      recommendation: rec,
      alternatives: (parsed.alternatives ?? [])
        .filter((a) => typeof a === "string")
        .map((a) => scrubForbiddenPhrases(String(a).trim()).slice(0, 120))
        .filter((a) => a.length > 0)
        .slice(0, 3),
      headline: scrubForbiddenPhrases(String(parsed.headline ?? "").trim()).slice(0, 80),
    };
  } catch {
    return fallbackResult(input);
  }
}
