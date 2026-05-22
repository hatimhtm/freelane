"use client";

import { useState, useTransition } from "react";
import { ArrowUp, Sparkles, TrendingUp, AlertTriangle, Route, UserX, Lightbulb, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { askYourMoney, generateMoneyInsights, type MoneyInsight } from "@/lib/ai/actions";

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

export function AiPanel({ enabled }: { enabled: boolean }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [insights, setInsights] = useState<MoneyInsight[] | null>(null);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [asking, startAsk] = useTransition();
  const [thinking, startInsights] = useTransition();

  if (!enabled) return null;

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
    <Card className="overflow-hidden border-border/70 p-6">
      <div className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-full bg-foreground text-background">
          <Sparkles className="size-3.5" />
        </span>
        <div>
          <div className="text-sm font-medium">Ask your money</div>
          <div className="text-xs text-muted-foreground">Anything about your income, clients, or fees.</div>
        </div>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); ask(); }}
        className="mt-4 flex items-center gap-2 rounded-xl border border-border/70 bg-background px-3 py-2 focus-within:border-foreground/30"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. how much did ViralFactory pay me this year?"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
        />
        <button
          type="submit"
          disabled={asking || !q.trim()}
          aria-label="Ask"
          className="grid size-7 max-md:size-9 shrink-0 place-items-center rounded-full bg-foreground text-background transition-transform hover:scale-105 disabled:opacity-40"
        >
          {asking ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" />}
        </button>
      </form>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => ask(s)}
            className="rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 max-md:py-2 text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          >
            {s}
          </button>
        ))}
      </div>

      <AnimatePresence>
        {answer !== null && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="mt-4 rounded-xl bg-muted/40 p-4 text-sm leading-relaxed"
          >
            {answer || <span className="text-muted-foreground">No answer.</span>}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-5 border-t border-border/50 pt-4">
        <div className="flex items-center justify-between">
          <span className="display-eyebrow text-muted-foreground">Insights</span>
          <button
            onClick={getInsights}
            disabled={thinking}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {thinking ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
            {insights ? "Refresh" : "Generate"}
          </button>
        </div>

        {insightsError && (
          <p className="mt-3 text-xs text-[var(--overdue)]">{insightsError}</p>
        )}

        <AnimatePresence>
          {insights && !insightsError && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }} className="mt-3 space-y-2">
              {insights.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing notable right now.</p>
              ) : (
                insights.map((ins, i) => {
                  const Icon = KIND_ICON[ins.kind] ?? Lightbulb;
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                      className="flex gap-3 rounded-xl border border-border/60 bg-card p-3"
                    >
                      <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-md", ins.kind === "anomaly" || ins.kind === "chase" ? "bg-[var(--overdue)]/12 text-[var(--overdue)]" : "bg-muted text-muted-foreground")}>
                        <Icon className="size-3.5" />
                      </span>
                      <div>
                        <div className="text-sm font-medium">{ins.title}</div>
                        <div className="text-xs text-muted-foreground">{ins.detail}</div>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Card>
  );
}
