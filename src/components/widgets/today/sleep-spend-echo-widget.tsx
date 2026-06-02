"use client";

import { useEffect, useState } from "react";
import { SleepWidget } from "@/components/widgets/today/sleep-widget";
import { refreshSleepSpendEcho } from "@/lib/ai/today-brain-actions";
import { phtDateString, phtToday } from "@/lib/utils";
import type { SleepSpendEcho } from "@/lib/ai/sleep-spend-echo";

// Sleep × Spend Echo — client widget. Delegates the visual contract to the
// existing SleepWidget; this wrapper just owns the cache-first / async-regen
// pattern so the AI line never blocks Today's first paint.

type Props = {
  initial: SleepSpendEcho | null;
  generatedAt: string | null;
  aiEnabled: boolean;
  recentNights: Array<{ slept: number | null }>;
};

export function SleepSpendEchoWidget({ initial, generatedAt, aiEnabled, recentNights }: Props) {
  const [echo, setEcho] = useState<SleepSpendEcho | null>(initial);
  const [loading, setLoading] = useState(() => {
    if (!aiEnabled) return false;
    if (!initial) return true;
    if (!generatedAt) return true;
    return phtDateString(new Date(generatedAt)) !== phtToday();
  });

  useEffect(() => {
    if (!loading) return;
    let cancelled = false;
    void refreshSleepSpendEcho()
      .then((res) => {
        if (!cancelled && res.ok) setEcho(res.data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loading]);

  return <SleepWidget recentNights={recentNights} echo={echo} />;
}
