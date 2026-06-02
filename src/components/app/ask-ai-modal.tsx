"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowUp, Sparkles, TrendingUp, AlertTriangle, Route, UserX, Lightbulb, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { CenterModal, CenterModalBody } from "@/components/ui/center-modal";
import { askYourMoney, generateMoneyInsights, type MoneyInsight } from "@/lib/ai/actions";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Who's slowest to pay me?",
  "Which way of getting paid is cheapest?",
  "How am I doing versus last month?",
  "What should I chase first?",
];

const KIND_ICON: Record<MoneyInsight["kind"], React.ElementType> = {
  routing: Route,
  anomaly: AlertTriangle,
  forecast: TrendingUp,
  chase: UserX,
  note: Lightbulb,
};

// T24 — Ask AI center modal. Replaces the inline AiPanel mount. Persistent
// across Today and Dashboard via the AskAiFloating button.

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  // Optional pre-filled question (used by TodayQuestionPills, ⌘K palette).
  prefill?: string | null;
};

export function AskAiModal({ open, onOpenChange, prefill }: Props) {
  const [q, setQ] = useState(prefill ?? "");
  const [answer, setAnswer] = useState<string | null>(null);
  const [insights, setInsights] = useState<MoneyInsight[] | null>(null);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [asking, startAsk] = useTransition();
  const [thinking, startInsights] = useTransition();

  // Sync prefill into the input when the modal opens with a new question.
  useEffect(() => {
    if (open && prefill) setQ(prefill);
  }, [open, prefill]);

  function ask(question?: string) {
    const text = (question ?? q).trim();
    if (!text) return;
    setQ(text);
    setAnswer(null);
    startAsk(async () => {
      const res = await askYourMoney(text);
      setAnswer(res.ok ? res.answer ?? "" : res.error ?? "Something went wrong.");
    });
  }

  function getInsights() {
    startInsights(async () => {
      const res = await generateMoneyInsights();
      if (!res.ok) {
        setInsightsError(res.error ?? "Couldn't generate insights.");
      } else {
        setInsights(res.insights);
        setInsightsError(null);
      }
    });
  }

  return (
    <CenterModal
      open={open}
      onOpenChange={onOpenChange}
      title="Ask your money"
      description="One question, anything you'd ask a sharp friend who saw every wallet."
      size="lg"
    >
      <CenterModalBody>
        <div className="grid gap-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask();
            }}
            className="relative"
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="How am I doing versus last month?"
              className="h-11 w-full rounded-md border border-border bg-background px-3 pr-11 text-sm outline-none focus-visible:ring-2 focus-visible:ring-foreground/15"
            />
            <button
              type="submit"
              disabled={asking || !q.trim()}
              aria-label="Ask"
              className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md bg-foreground text-background transition-opacity disabled:opacity-40"
            >
              {asking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
            </button>
          </form>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => ask(s)}
                className="rounded-full border border-border px-3 py-1 text-[11.5px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
              >
                {s}
              </button>
            ))}
          </div>
          <AnimatePresence>
            {answer && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="rounded-md bg-foreground/[0.03] p-3 text-[13px] leading-relaxed text-foreground"
              >
                {answer}
              </motion.div>
            )}
          </AnimatePresence>
          <div className="border-t border-border/40 pt-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                <Sparkles className="h-3 w-3" />
                Insights
              </div>
              <button
                type="button"
                onClick={getInsights}
                disabled={thinking}
                className="text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                {thinking ? "Reading…" : "Generate insights"}
              </button>
            </div>
            {insightsError && (
              <p className="mt-2 text-[12px] text-rose-500">{insightsError}</p>
            )}
            {insights && (
              <ul className="mt-3 space-y-2">
                {insights.map((i, idx) => {
                  const Icon = KIND_ICON[i.kind];
                  return (
                    <li
                      key={idx}
                      className={cn(
                        "flex gap-3 rounded-md border border-border/50 bg-card/40 p-3",
                      )}
                    >
                      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/70" />
                      <div>
                        <div className="text-[13px] font-medium text-foreground">{i.title}</div>
                        <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                          {i.detail}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </CenterModalBody>
    </CenterModal>
  );
}
