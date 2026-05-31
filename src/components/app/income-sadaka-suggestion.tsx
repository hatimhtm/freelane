"use client";

import { useState } from "react";
import NumberFlow from "@number-flow/react";
import { AnimatePresence, motion } from "motion/react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;

interface Suggestion {
  suggestedBase: number;
  percent: number;
  reason: string;
}

interface TriggeringPayment {
  client: string;
  net: number;
  paid_at: string;
}

// After a payment lands, surface a small, calmly worded sadaka portion. Reads
// `SafeToSpendOverlay.sadakaSuggestionBase` paired with the payment that
// triggered the window. Reasoning ("stable window") comes from the math layer.
// Acid-lime fill on "Set aside" is permitted here — this card has exactly one
// primary action and that action is the screen's reason for being.
export function IncomeSadakaSuggestion({
  suggestion,
  triggeringPayment,
  sadakaCategoryId,
}: {
  suggestion: Suggestion;
  triggeringPayment: TriggeringPayment | null;
  sadakaCategoryId: string | null;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!suggestion || suggestion.suggestedBase <= 0) return null;
  if (!triggeringPayment) return null;

  const { suggestedBase, percent, reason } = suggestion;
  const { client, net, paid_at } = triggeringPayment;
  const percentLabel = `${(percent * 100).toFixed(percent < 0.05 ? 1 : 0)}%`;
  const stabilityNote = stabilityFromReason(reason);

  function openSpendSheet() {
    if (typeof window === "undefined") return;
    // Integration point: page wires this to its spend-create sheet,
    // pre-filling Sadaka category + suggestedBase. Emitted only on confirm.
    window.dispatchEvent(
      new CustomEvent("freelane:open-spend-sheet", {
        detail: {
          source: "sadaka-suggestion",
          categoryId: sadakaCategoryId ?? undefined,
          amountBase: suggestedBase,
          note: `Sadaka from ${client} payment`,
          triggeringPaymentPaidAt: paid_at,
        },
      }),
    );
  }

  function handleSetAside() {
    setConfirmOpen(false);
    openSpendSheet();
    // Fade the card out a beat after the sheet appears so the affirm reads.
    window.setTimeout(() => setDismissed(true), 220);
  }

  return (
    <>
      <AnimatePresence initial={false}>
        {!dismissed && (
          <motion.section
            key="sadaka-suggestion"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.32, ease: EASE }}
            className="rounded-2xl bg-paper px-7 py-6 ring-1 ring-ink/10"
          >
            <div className="display-eyebrow text-ink/55">Suggested sadaka</div>

            <div className="mt-4 flex items-baseline gap-3">
              <NumberFlow
                value={Math.max(0, Math.round(suggestedBase))}
                format={{
                  style: "currency",
                  currency: "PHP",
                  maximumFractionDigits: 0,
                }}
                transformTiming={{
                  duration: 700,
                  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
                }}
                className="font-fraunces text-[56px] leading-none tracking-tight text-ink tabular"
              />
            </div>

            <p className="mt-5 max-w-prose text-[15px] leading-relaxed text-ink/75">
              After {client} {formatCompactPhp(net)} landed — {percentLabel}
              {stabilityNote ? ` (${stabilityNote})` : ""}.
            </p>

            <div className="mt-7 flex items-center gap-5">
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                className={cn(
                  "inline-flex h-10 items-center justify-center rounded-lg px-5 text-[13px] font-medium tracking-tight",
                  "bg-[var(--brand)] text-[var(--brand-foreground)]",
                  "transition-[transform,filter] duration-300 ease-out",
                  "hover:brightness-[0.97] active:translate-y-px",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30",
                )}
              >
                Set aside
              </button>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="text-[13px] text-ink/55 transition-colors duration-300 ease-out hover:text-ink/80"
              >
                Not now
              </button>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <Sheet open={confirmOpen} onOpenChange={setConfirmOpen}>
        <SheetContent side="bottom" className="bg-paper">
          <SheetHeader>
            <div className="display-eyebrow text-ink/55">Set aside</div>
            <SheetTitle className="mt-3 font-fraunces text-[40px] leading-none tracking-tight text-ink tabular">
              {formatMoney(suggestedBase, "PHP", { compact: true })}
            </SheetTitle>
            <SheetDescription className="mt-3 text-[14px] leading-relaxed text-ink/70">
              From {client} {formatCompactPhp(net)} — {percentLabel} sadaka.
              Logs as a Sadaka spend.
            </SheetDescription>
          </SheetHeader>
          <SheetFooter className="flex-row items-center justify-end gap-4">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="text-[13px] text-ink/55 transition-colors duration-300 ease-out hover:text-ink/80"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSetAside}
              className={cn(
                "inline-flex h-10 items-center justify-center rounded-lg px-5 text-[13px] font-medium tracking-tight",
                "bg-[var(--brand)] text-[var(--brand-foreground)]",
                "transition-[transform,filter] duration-300 ease-out",
                "hover:brightness-[0.97] active:translate-y-px",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30",
              )}
            >
              Continue
            </button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

// Pull the stability phrase out of the math layer's reason string so the
// sentence reads "3% (stable window)" without parroting the whole reason.
function stabilityFromReason(reason: string): string | null {
  const lower = reason.toLowerCase();
  if (lower.includes("strong window")) return "strong window";
  if (lower.includes("stable window")) return "stable window";
  if (lower.includes("lean window")) return "lean window";
  if (lower.includes("recovery")) return "recovery";
  if (lower.includes("while learning")) return "still learning";
  return null;
}

function formatCompactPhp(amount: number): string {
  return formatMoney(amount, "PHP", { compact: true });
}
