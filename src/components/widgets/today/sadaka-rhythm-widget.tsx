"use client";

import { useEffect, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { SadakaRhythmCard } from "@/components/app/sadaka-rhythm-card";
import { refreshSadakaRhythm } from "@/lib/ai/today-brain-actions";
import { phtDateString, phtToday } from "@/lib/utils";
import type { SadakaRhythmRead } from "@/lib/ai/sadaka-rhythm";
import type { CurrencyCode } from "@/lib/supabase/types";

// Sadaka rhythm — client widget mirroring TodaysFocusWidget. The standing
// rhythm read is cheap to recompute, but the AI narrative line is the
// expensive part. Cache-first read + async regen keeps Today's first paint
// off the Gemini critical path.

type Props = {
  initial: SadakaRhythmRead | null;
  generatedAt: string | null;
  aiEnabled: boolean;
  baseCurrency: CurrencyCode;
};

export function SadakaRhythmWidget({ initial, generatedAt, aiEnabled, baseCurrency }: Props) {
  const [read, setRead] = useState<SadakaRhythmRead | null>(initial);
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
    void refreshSadakaRhythm()
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
      const res = await refreshSadakaRhythm({ force: true });
      if (res.ok) setRead(res.data);
    });
  };

  if (!read || read.givenCount === 0) return null;

  return (
    <div className="relative">
      <SadakaRhythmCard read={read} baseCurrency={baseCurrency} />
      <button
        type="button"
        onClick={handleRefresh}
        disabled={pending || loading}
        aria-label="Refresh Sadaka rhythm"
        className="absolute right-3 top-3 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
      >
        <RefreshCw className={pending || loading ? "h-2.5 w-2.5 animate-spin" : "h-2.5 w-2.5"} />
      </button>
    </div>
  );
}
