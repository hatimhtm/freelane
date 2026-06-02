import type { PlanStrategyKind } from "@/lib/supabase/types";

// Shared client-safe label map for plan_strategies.strategy_kind. Both the
// detail-sheet strategy options card and any server reader that wants a
// human-readable label import from here so the labels can never drift
// between client + server. Pure constants module — no IO, no server-only.

export const PLAN_STRATEGY_KIND_LABELS: Record<PlanStrategyKind, string> = {
  reduce_safe: "Lower daily safe",
  skip_category: "Skip a category",
  channel_sadaka_overflow: "Channel sadaka overflow",
  wait_for_payment: "Wait for the next payment",
  cut_eating_out: "Less eating out",
  pause_other_plan: "Pause another plan",
  alternative_route: "Buy a cheaper alternative",
};

export function planStrategyKindLabel(kind: PlanStrategyKind): string {
  return PLAN_STRATEGY_KIND_LABELS[kind] ?? kind;
}
