"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Lightbulb, Loader2, RefreshCcw, Route, Sparkles, TrendingUp, UserX } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getDailyFocus, type MoneyInsight } from "@/lib/ai/actions";

const KIND_ICON: Record<MoneyInsight["kind"], React.ElementType> = {
  routing: Route,
  anomaly: AlertTriangle,
  forecast: TrendingUp,
  chase: UserX,
  note: Lightbulb,
};

const EASE = [0.16, 1, 0.3, 1] as const;

// The morning concierge card — Gemini reads the whole ledger and picks the few
// things worth doing today. Cached server-side; auto-refreshes when older than
// 24h (checked on mount) and on the manual button.
export function TodaysFocus({
  initialInsights,
  initialGeneratedAt,
  enabled,
}: {
  initialInsights: MoneyInsight[];
  initialGeneratedAt: string | null;
  enabled: boolean;
}) {
  const [insights, setInsights] = useState<MoneyInsight[]>(initialInsights);
  const [generatedAt, setGeneratedAt] = useState<string | null>(initialGeneratedAt);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ranAuto = useRef(false);

  async function run(force: boolean) {
    setLoading(true);
    setError(null);
    try {
      // Don't let a hung request strand the card on a skeleton forever.
      const res = await Promise.race([
        getDailyFocus({ force }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timed out — try again.")), 75_000),
        ),
      ]);
      if (res.ok) {
        setInsights(res.insights);
        setGeneratedAt(res.generatedAt);
      } else {
        setError(res.error ?? "Couldn't generate focus.");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Auto-generate on open when there's nothing yet or it's gone stale (>24h).
  useEffect(() => {
    if (!enabled || ranAuto.current) return;
    ranAuto.current = true;
    const stale =
      insights.length === 0 ||
      !generatedAt ||
      Date.now() - new Date(generatedAt).getTime() > 24 * 3_600_000;
    if (stale) void run(false);
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled) return null;

  return (
    <Card className="aurora-none overflow-hidden p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-full bg-foreground text-background">
            <Sparkles className="size-3.5" />
          </span>
          <div>
            <div className="display-eyebrow text-muted-foreground">Today&apos;s Focus</div>
            <div className="text-xs text-muted-foreground/70">{generatedAt ? `Updated ${relative(generatedAt)}` : "Not generated yet"}</div>
          </div>
        </div>
        <button
          onClick={() => run(true)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Regenerate today's focus"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
          Regenerate
        </button>
      </div>

      <div className="mt-4">
        {loading && insights.length === 0 ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-muted/50" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-[var(--overdue)]">{error}</p>
        ) : insights.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing urgent — you&apos;re on top of things. Hit regenerate any time.</p>
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {insights.map((ins, i) => {
                const Icon = KIND_ICON[ins.kind] ?? Lightbulb;
                const hot = ins.kind === "anomaly" || ins.kind === "chase";
                return (
                  <motion.div
                    key={`${ins.title}-${i}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: i * 0.06, ease: EASE }}
                    className="flex gap-3 rounded-xl border border-border/60 bg-card p-3.5"
                  >
                    <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-md", hot ? "bg-[var(--overdue)]/12 text-[var(--overdue)]" : "bg-muted text-muted-foreground")}>
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{ins.title}</div>
                      <div className="text-xs text-muted-foreground">{ins.detail}</div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </Card>
  );
}

function relative(iso: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
