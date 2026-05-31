"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import NumberFlow from "@number-flow/react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import type { SafeToSpendOverlay, SafeToSpendVerdict } from "@/lib/ai/safe-to-spend-ai";

const EASE = [0.22, 1, 0.36, 1] as const;

const VERDICT_COPY: Record<SafeToSpendVerdict, string> = {
  comfortable: "Comfortable",
  watchful: "Watchful",
  tight: "Tight",
  lean: "Lean",
};

// Lime for the safe end of the spectrum, terracotta for the careful end.
// Color is information, never decoration — and never a full background.
function verdictAccent(v: SafeToSpendVerdict): string {
  return v === "tight" || v === "lean"
    ? "border-[var(--overdue)]"
    : "border-[var(--brand)]";
}

export function MorningBriefHero({ overlay }: { overlay: SafeToSpendOverlay | null }) {
  const [open, setOpen] = useState(false);

  if (!overlay) {
    return (
      <section className="paper-grain px-1 pb-12 pt-2">
        <div className="display-eyebrow text-muted-foreground">Safe to spend today</div>
        <div className="mt-5 flex items-baseline gap-3">
          <span className="display-numeric tabular text-[clamp(56px,9vw,96px)] text-foreground/30">
            —
          </span>
        </div>
        <p className="mt-6 max-w-prose text-[15px] leading-relaxed text-muted-foreground">
          Still learning your patterns. Log a few payments and spends and the number will arrive.
        </p>
      </section>
    );
  }

  const { safeTodayBase, verdict, oneLineReasoning, isLearning, baseline } = overlay;
  const accent = verdictAccent(verdict);

  return (
    <section className="paper-grain px-1 pb-12 pt-2">
      <div className="display-eyebrow text-muted-foreground">Safe to spend today</div>

      <div className="mt-5 flex items-baseline gap-4">
        <NumberFlow
          value={Math.max(0, Math.round(safeTodayBase))}
          format={{ style: "currency", currency: "PHP", maximumFractionDigits: 0 }}
          transformTiming={{ duration: 700, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}
          className="display-numeric tabular text-[clamp(56px,9vw,96px)] text-foreground"
        />
        <span
          className={cn(
            "translate-y-[-0.6em] border-l-2 pl-3 text-[13px] font-medium tracking-tight text-foreground/80",
            accent,
          )}
        >
          {VERDICT_COPY[verdict]}
        </span>
      </div>

      {oneLineReasoning && (
        <p className="mt-6 max-w-prose text-[15px] leading-relaxed text-foreground/75">
          {oneLineReasoning}
        </p>
      )}

      {isLearning && (
        <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-muted-foreground">
          Still calibrating — the formula is using conservative defaults.
        </p>
      )}

      <div className="mt-6">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="group inline-flex items-center gap-1.5 rounded-full px-0 py-1 text-[12px] font-medium uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
        >
          {open ? "Hide breakdown" : "Show breakdown"}
          <ChevronDown
            className={cn(
              "size-3.5 transition-transform duration-300 ease-out",
              open && "rotate-180",
            )}
          />
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="breakdown"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.32, ease: EASE }}
              className="overflow-hidden"
            >
              <dl className="mt-5 grid grid-cols-1 gap-x-12 gap-y-4 border-t border-border/60 pt-5 sm:grid-cols-3">
                <BreakdownRow
                  label="Committed pool"
                  value={formatMoney(baseline.committedPoolBase, "PHP", { compact: true })}
                  detail={`${Math.round(baseline.recurringForwardBase).toLocaleString()} recurring · ${Math.round(baseline.loanForwardBase).toLocaleString()} loans · ${Math.round(baseline.feeFloorBase).toLocaleString()} fee floor`}
                />
                <BreakdownRow
                  label="Discretionary"
                  value={formatMoney(baseline.discretionaryPoolBase, "PHP", { compact: true })}
                  detail={`over ${baseline.horizonDays} days`}
                />
                <BreakdownRow
                  label="Stability"
                  value={`× ${baseline.stabilityMultiplier.toFixed(2)}`}
                  detail={
                    baseline.inRecovery
                      ? `recovery −${formatMoney(baseline.recoveryDailyTaxBase, "PHP", { compact: true })}/day`
                      : `score ${baseline.stabilityScore.toFixed(2)}`
                  }
                />
              </dl>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function BreakdownRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div>
      <dt className="display-eyebrow text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 text-[20px] font-medium tabular tracking-tight text-foreground">
        {value}
      </dd>
      <dd className="mt-0.5 text-[12px] text-muted-foreground tabular">{detail}</dd>
    </div>
  );
}
