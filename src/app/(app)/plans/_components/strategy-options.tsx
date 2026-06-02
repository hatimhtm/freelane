"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  activateStrategy,
  deactivateStrategy,
  proposeStrategies,
} from "@/app/(app)/plans/_actions/plan-actions";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode, PlanStrategy } from "@/lib/supabase/types";
import { PLAN_STRATEGY_KIND_LABELS as KIND_LABELS } from "@/lib/plan-strategy-labels";

// Plans redesign — strategy options inside the plan detail sheet.
// Renders 0-3 ranked Strategy cards sorted by rank ASC (the brain
// already sorts by realism DESC and re-ranks; we trust the persisted
// rank). One active per plan is enforced by a partial unique index in
// finance.plan_strategies — Activate first deactivates any other active
// row for the same plan, then sets the picked row to active=true.

export function StrategyOptions({
  planId,
  strategies,
  baseCurrency,
}: {
  planId: string;
  strategies: PlanStrategy[];
  baseCurrency: CurrencyCode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const ranked = [...strategies]
    .filter((s) => s.plan_id === planId)
    .sort((a, b) => a.rank - b.rank);

  const refresh = () => {
    start(async () => {
      const res = await proposeStrategies(planId);
      if (!res.ok) {
        toast.error(res.error || "Couldn't refresh.");
        return;
      }
      router.refresh();
    });
  };

  const activate = (id: string) => {
    start(async () => {
      const res = await activateStrategy(id);
      if (!res.ok) {
        toast.error(res.error || "Couldn't activate.");
        return;
      }
      router.refresh();
    });
  };

  const deactivate = (id: string) => {
    start(async () => {
      const res = await deactivateStrategy(id);
      if (!res.ok) {
        toast.error(res.error || "Couldn't deactivate.");
        return;
      }
      router.refresh();
    });
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-sm font-medium">Strategy options</h3>
        <button
          type="button"
          onClick={refresh}
          disabled={pending}
          className="text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          {pending ? "Working..." : ranked.length === 0 ? "Propose" : "Refresh"}
        </button>
      </div>

      {ranked.length === 0 && (
        <div className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
          No strategies proposed yet. Tap Propose to ask the brain.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {ranked.map((s) => {
          const sideEffects = (s.body?.side_effects ?? []) as string[];
          const monthlySave = Number(s.monthly_save_estimate ?? 0);
          const realism = Number(s.realism_score ?? 0);
          return (
            <div
              key={s.id}
              className="flex flex-col gap-2 rounded-[10px] border border-border/60 bg-card/40 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Rank {s.rank}
                    </span>
                    <span className="text-sm font-medium text-foreground">
                      {s.title || KIND_LABELS[s.strategy_kind]}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {KIND_LABELS[s.strategy_kind]}
                    {monthlySave > 0 && (
                      <>
                        {" · "}
                        <span className="tabular text-foreground/80">
                          ~{formatMoney(monthlySave, baseCurrency, { compact: true })}/mo
                        </span>
                      </>
                    )}
                    {s.estimated_completion && (
                      <> · by {s.estimated_completion}</>
                    )}
                    {realism > 0 && (
                      <> · realism {(realism * 100).toFixed(0)}%</>
                    )}
                  </div>
                </div>
                <div className="shrink-0">
                  {s.active ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => deactivate(s.id)}
                      disabled={pending}
                    >
                      Active · deactivate
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => activate(s.id)}
                      disabled={pending}
                    >
                      Activate
                    </Button>
                  )}
                </div>
              </div>
              {sideEffects.length > 0 && (
                <ul className="text-[11px] leading-snug text-muted-foreground">
                  {sideEffects.map((eff, i) => (
                    <li key={i}>· {eff}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
