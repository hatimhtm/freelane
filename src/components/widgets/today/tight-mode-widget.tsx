"use client";

import { useEffect, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { TightModeCoach } from "@/components/app/tight-mode-coach";
import { refreshTightMode } from "@/lib/ai/today-brain-actions";
import { phtDateString, phtToday } from "@/lib/utils";
import type { TightModeRead } from "@/lib/ai/tight-mode-coach";
import type { CurrencyCode } from "@/lib/supabase/types";

// Tight-Mode Coach — client widget mirroring TodaysFocusWidget. Reads the
// brain cache server-side (initial prop) and decides at mount whether the
// payload is PHT-day stale. If stale (or absent + AI enabled), kicks off
// refreshTightMode() so the AI swap happens AFTER first paint instead of
// blocking it. Refresh button is always available for manual regen.
//
// Output is rendered through the existing TightModeCoach app component so
// the visual contract stays consistent with the rest of Today. The card
// self-hides when read.active is false (storm/gust only band).

type Props = {
  initial: TightModeRead | null;
  generatedAt: string | null;
  aiEnabled: boolean;
  baseCurrency: CurrencyCode;
};

export function TightModeWidget({ initial, generatedAt, aiEnabled, baseCurrency }: Props) {
  const [read, setRead] = useState<TightModeRead | null>(initial);
  const [pending, start] = useTransition();
  const [loading, setLoading] = useState(() => {
    if (!aiEnabled) return false;
    if (!initial) return true;
    if (!generatedAt) return true;
    return phtDateString(new Date(generatedAt)) !== phtToday();
  });

  useEffect(() => {
    if (!loading) return;
    let cancelled = false;
    void refreshTightMode()
      .then((res) => {
        if (!cancelled && res.ok) setRead(res.data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loading]);

  const handleRefresh = () => {
    start(async () => {
      const res = await refreshTightMode({ force: true });
      if (res.ok) setRead(res.data);
    });
  };

  if (!read || !read.active) return null;

  return (
    <div className="relative">
      <TightModeCoach read={read} baseCurrency={baseCurrency} />
      <button
        type="button"
        onClick={handleRefresh}
        disabled={pending || loading}
        aria-label="Refresh tight mode read"
        className="absolute right-3 top-3 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
      >
        <RefreshCw className={pending || loading ? "h-2.5 w-2.5 animate-spin" : "h-2.5 w-2.5"} />
      </button>
    </div>
  );
}
