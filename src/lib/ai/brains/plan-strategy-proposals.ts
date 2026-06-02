import "server-only";

import { Type } from "@google/genai";
import { gemini, hasGemini, pickModel } from "../models";
import { withBrainCache, fingerprintFromIds, scopedBrainKey } from "../cache";
import { BRAIN_KEYS } from "../cache-keys";
import { scrubForbiddenPhrases, hasForbidden } from "../voice-scrub";
import type { PlanStrategyKind } from "@/lib/supabase/types";

// Pro brain — plan_strategy_proposals.
//
// Given a plan + the user's current financial state, propose 2-3 ranked
// savings strategies the user can activate to reach the plan sooner.
// Strategy kinds are bounded by the migration 0089 check constraint — the
// model picks among them, weaves in side-effects, and ranks by realism.
//
// Cache: per-plan_id slot + state_hash fingerprint. The 24h TTL is a
// shelf marker; the state_hash is what makes the result stale — wallet
// balance / income / sadaka pool drifting beyond a small bucket
// invalidates the cached set so the next read regenerates.
//
// "Realism" is the model's own honest estimate of whether the user can
// stick with this for the duration. The detail sheet sorts cards DESC by
// realism_score, so rank 1 surfaces first.
//
// Output is sanitized for forbidden phrases on every visible string
// (title + side_effects + any future narrative). Strategy kinds and rank
// pass through verbatim.

const STRATEGY_KINDS = [
  "reduce_safe",
  "skip_category",
  "channel_sadaka_overflow",
  "wait_for_payment",
  "cut_eating_out",
  "pause_other_plan",
  "alternative_route",
] as const satisfies readonly PlanStrategyKind[];

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    strategies: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          strategy_kind: { type: Type.STRING },
          rank: { type: Type.NUMBER },
          title: { type: Type.STRING },
          side_effects: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          monthly_save_estimate: { type: Type.NUMBER },
          estimated_completion: { type: Type.STRING },
          realism_score: { type: Type.NUMBER },
          applicable_now: { type: Type.BOOLEAN },
        },
        required: [
          "strategy_kind",
          "rank",
          "title",
          "side_effects",
          "monthly_save_estimate",
          "realism_score",
          "applicable_now",
        ],
      },
    },
  },
  required: ["strategies"],
} as const;

const SYSTEM_PROMPT = `You propose 2-3 ranked savings strategies for ONE planned purchase.

Voice: flat, plain, observational. Statements not commands. The freelance
dev reading this is already capable — describe options, don't lecture.

Hard rules:
- strategy_kind must be one of:
  reduce_safe, skip_category, channel_sadaka_overflow, wait_for_payment,
  cut_eating_out, pause_other_plan, alternative_route
- rank is 1, 2, or 3. Lower rank = more recommended.
- title is one short noun phrase. ≤ 60 chars. Never start with a verb in
  command form ("Stop eating out" → "Less eating out").
- side_effects is 1-3 bullets, each ≤ 60 chars. Plain statements.
- monthly_save_estimate is a PHP whole number. Honest about scale — don't
  invent ₱20,000/mo if the user's safe-to-spend is ₱500/day.
- estimated_completion is "YYYY-MM-DD" or omitted.
- realism_score in [0, 1]. 0.9+ only when the side-effects are small
  enough to sustain. Below 0.4 → don't include the strategy at all.
- applicable_now: true if the strategy works from today; false if it
  depends on an event (payment lands, plan replaces another, …).
- NEVER use: "you should", "consider", "save more", "stay positive",
  "well done", "great job", "amazing"

Return ONLY {"strategies": [...]} JSON.`;

export type PlanStrategyProposalsInput = {
  planId: string;
  plan: {
    label: string;
    expected_base: number;
    target_date?: string | null;
    justification?: string | null;
  };
  walletBalanceBase: number;
  dailySafeBase: number;
  plannedHorizonBase: number; // sum of other planned spends in window
  sadakaPoolBase?: number;
  spendingPatterns?: {
    monthlyEatingOutBase?: number;
    monthlyDiscretionaryBase?: number;
  };
  stateHash: string; // caller-provided bucket hash of inputs above
};

export type PlanStrategyProposal = {
  strategy_kind: PlanStrategyKind;
  rank: 1 | 2 | 3;
  title: string;
  side_effects: string[];
  monthly_save_estimate: number;
  estimated_completion: string | null;
  realism_score: number;
  applicable_now: boolean;
};

export type PlanStrategyProposalsResult = {
  strategies: PlanStrategyProposal[];
};

function emptyResult(): PlanStrategyProposalsResult {
  return { strategies: [] };
}

function isStrategyKind(s: string): s is PlanStrategyKind {
  return (STRATEGY_KINDS as readonly string[]).includes(s);
}

export async function proposePlanStrategies(
  input: PlanStrategyProposalsInput,
): Promise<PlanStrategyProposalsResult> {
  if (!hasGemini()) return emptyResult();
  if (!input.plan.label.trim()) return emptyResult();

  // Fingerprint = plan_id + state_hash + the input buckets the brain
  // actually consults. Including sadakaPoolBase + spendingPatterns
  // here directly defends against a caller that forgets to fold them
  // into state_hash — the cache stays honest even if the upstream
  // bucket policy drifts.
  const fp = await fingerprintFromIds([
    "plan_strategy_proposals",
    input.planId,
    input.stateHash,
    String(Math.round((input.sadakaPoolBase ?? 0) / 500) * 500),
    String(Math.round((input.spendingPatterns?.monthlyEatingOutBase ?? 0) / 200) * 200),
    String(Math.round((input.spendingPatterns?.monthlyDiscretionaryBase ?? 0) / 500) * 500),
  ]);

  const cached = await withBrainCache<PlanStrategyProposalsResult>({
    brainKey: scopedBrainKey(BRAIN_KEYS.PLAN_STRATEGY_PROPOSALS, "plan", input.planId),
    fingerprint: fp,
    phtDayAnchored: false,
    regen: async () => {
      const lines: string[] = [
        `PLAN: ${input.plan.label}`,
        `EXPECTED PRICE (PHP): ${Math.round(input.plan.expected_base)}`,
        input.plan.target_date ? `TARGET DATE: ${input.plan.target_date}` : null,
        input.plan.justification
          ? `WHY (user): ${input.plan.justification.slice(0, 400)}`
          : null,
        "",
        "FINANCIAL CONTEXT:",
        `- wallet balance: ${Math.round(input.walletBalanceBase)} PHP`,
        `- daily safe: ${Math.round(input.dailySafeBase)} PHP`,
        `- other planned spends in window: ${Math.round(input.plannedHorizonBase)} PHP`,
        input.sadakaPoolBase !== undefined
          ? `- sadaka pool: ${Math.round(input.sadakaPoolBase)} PHP`
          : null,
        input.spendingPatterns?.monthlyEatingOutBase !== undefined
          ? `- monthly eating-out spend: ${Math.round(
              input.spendingPatterns.monthlyEatingOutBase,
            )} PHP`
          : null,
        input.spendingPatterns?.monthlyDiscretionaryBase !== undefined
          ? `- monthly discretionary spend: ${Math.round(
              input.spendingPatterns.monthlyDiscretionaryBase,
            )} PHP`
          : null,
        "",
        "Propose 2-3 ranked savings strategies. Return JSON.",
      ].filter(Boolean) as string[];

      const res = await gemini().models.generateContent({
        model: pickModel("heavy"),
        contents: lines.join("\n"),
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.4,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      });
      const parsed = JSON.parse((res.text ?? "{}").trim()) as Partial<{
        strategies: Array<{
          strategy_kind: string;
          rank: number;
          title: string;
          side_effects?: string[];
          monthly_save_estimate?: number;
          estimated_completion?: string | null;
          realism_score?: number;
          applicable_now?: boolean;
        }>;
      }>;
      const cleaned: PlanStrategyProposal[] = (parsed.strategies ?? [])
        .filter((s) => s && isStrategyKind(String(s.strategy_kind)))
        .map((s) => {
          const rank = Math.max(1, Math.min(3, Math.round(Number(s.rank) || 1))) as 1 | 2 | 3;
          // title + side_effects are short noun phrases (label-shaped),
          // not prose. hasForbidden rejects bullets that contain a
          // forbidden phrase outright; scrubForbiddenPhrases is the
          // fallback for the title because dropping the title would
          // sink the whole strategy card.
          const title = scrubForbiddenPhrases(String(s.title).trim()).slice(0, 80);
          const sideEffects = (s.side_effects ?? [])
            .filter((e) => typeof e === "string")
            .map((e) => String(e).trim().slice(0, 80))
            .filter((e) => e.length > 0 && !hasForbidden(e))
            .slice(0, 4);
          const monthlySave = Math.max(0, Math.round(Number(s.monthly_save_estimate) || 0));
          const realism = Math.max(0, Math.min(1, Number(s.realism_score) || 0));
          return {
            strategy_kind: s.strategy_kind as PlanStrategyKind,
            rank,
            title,
            side_effects: sideEffects,
            monthly_save_estimate: monthlySave,
            estimated_completion: s.estimated_completion
              ? String(s.estimated_completion).slice(0, 10)
              : null,
            realism_score: realism,
            applicable_now: s.applicable_now !== false,
          };
        })
        .filter((s) => s.title.length > 0 && s.realism_score >= 0.4)
        // Sort by realism_score DESC FIRST, then take the top 3 — the
        // previous order (slice then sort) silently dropped a
        // high-realism strategy at model-order index 4 while keeping a
        // low-realism strategy at index 0. Re-rank 1..3 after sorting
        // so the detail-sheet rank label matches the post-sort position.
        .sort((a, b) => b.realism_score - a.realism_score)
        .slice(0, 3)
        .map((s, idx) => ({ ...s, rank: (idx + 1) as 1 | 2 | 3 }));
      return { strategies: cleaned };
    },
  });

  return cached?.payload ?? emptyResult();
}
