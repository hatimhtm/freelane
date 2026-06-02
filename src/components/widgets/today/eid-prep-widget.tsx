"use client";

import { useEffect, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { EidPrepCard } from "@/components/app/eid-prep-card";
import { refreshEidPrep } from "@/lib/ai/today-brain-actions";
import { phtDateString, phtToday } from "@/lib/utils";
import type { EidPrepRead } from "@/lib/ai/eid-prep";
import type { CurrencyCode } from "@/lib/supabase/types";

// Eid prep card — client widget that mirrors TodaysFocusWidget. Reads the
// brain cache server-side and decides at mount whether to fire a regen.
// The visible UI is the existing EidPrepCard for the first upcoming window.

type Props = {
  initial: EidPrepRead | null;
  generatedAt: string | null;
  aiEnabled: boolean;
  baseCurrency: CurrencyCode;
};

export function EidPrepWidget({ initial, generatedAt, aiEnabled, baseCurrency }: Props) {
  const [read, setRead] = useState<EidPrepRead | null>(initial);
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
    void refreshEidPrep()
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
      const res = await refreshEidPrep({ force: true });
      if (res.ok) setRead(res.data);
    });
  };

  const firstWindow = read?.windows?.[0];
  if (!firstWindow) return null;

  return (
    <div className="relative">
      <EidPrepCard card={firstWindow} baseCurrency={baseCurrency} />
      <button
        type="button"
        onClick={handleRefresh}
        disabled={pending || loading}
        aria-label="Refresh Eid prep"
        className="absolute right-3 top-3 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
      >
        <RefreshCw className={pending || loading ? "h-2.5 w-2.5 animate-spin" : "h-2.5 w-2.5"} />
      </button>
    </div>
  );
}
