"use client";

import { useEffect, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { SWidget } from "@/components/widgets/s-widget";
import { getDailyFocus } from "@/lib/ai/actions";
import { phtDateString, phtToday } from "@/lib/utils";
import type { MoneyInsight } from "@/lib/ai/actions";

// T17 — Today's Focus S widget. AI-driven, async-loading. Reads cache
// server-side and triggers regen client-side if stale. Never blocks first
// paint. No icon — Brain isn't in the locked vocabulary; the tooltip label
// "Today's focus" carries the textual identity.
//
// S contract revision: hero now holds the FIRST insight's title (text hero,
// display-headline) because the count-of-insights was a number that didn't
// answer any glance-test question. The sub line surfaces "+N more" if there
// are extra insights and the refresh hint. Whole-card click opens the metric
// sheet (router push to /spending where the full focus list lives); the
// dedicated refresh control sits in the sub line and uses stopPropagation.
//
// Staleness rule (per cache brief trigger #a): compare PHT-day, NOT a
// rolling 24h. A cache generated yesterday in PHT is yesterday's view even
// if less than 24h has elapsed.

type Props = {
  initial: MoneyInsight[];
  generatedAt: string | null;
  aiEnabled: boolean;
};

export function TodaysFocusWidget({ initial, generatedAt, aiEnabled }: Props) {
  const [insights, setInsights] = useState<MoneyInsight[]>(initial);
  const [pending, start] = useTransition();
  const [loading, setLoading] = useState(() => {
    // Mount-time decision: kick off a regen if data is missing or PHT-day
    // older than today. NOT a rolling 24h window — the user's day is the
    // canonical bucket.
    if (!aiEnabled) return false;
    if (initial.length === 0) return true;
    if (!generatedAt) return true;
    const cachedPhtDay = phtDateString(new Date(generatedAt));
    return cachedPhtDay !== phtToday();
  });

  useEffect(() => {
    if (!loading) return;
    let cancelled = false;
    void getDailyFocus()
      .then((res) => {
        if (!cancelled && res.ok) setInsights(res.insights);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loading]);

  const head = insights[0];
  const more = Math.max(0, insights.length - 1);
  const headTitle =
    loading && !head ? "Loading…" : head?.title ?? "No signals today";

  const handleRefresh = () => {
    start(async () => {
      const res = await getDailyFocus({ force: true });
      if (res.ok) setInsights(res.insights);
    });
  };

  return (
    <SWidget
      label="Today's focus"
      hero={
        <span className="block text-[15px] font-medium leading-tight line-clamp-2">
          {headTitle}
        </span>
      }
      sub={
        <span className="flex items-center gap-2">
          {more > 0 && <span>+{more} more</span>}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleRefresh();
            }}
            disabled={pending}
            aria-label="Refresh focus"
            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={pending || loading ? "h-2.5 w-2.5 animate-spin" : "h-2.5 w-2.5"} />
            refresh
          </button>
        </span>
      }
      // Whole-card click opens an inline metric route instead of silently
      // regenerating Gemini. Refresh is now an explicit affordance only.
      onOpen={
        head?.detail
          ? () => {
              if (typeof window !== "undefined") {
                window.location.assign("/spending");
              }
            }
          : undefined
      }
    />
  );
}
