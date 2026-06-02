"use client";

import { useEffect, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { PostPaydaySurgeCard } from "@/components/app/post-payday-surge-card";
import { refreshPostPaydaySurge } from "@/lib/ai/today-brain-actions";
import { phtDateString, phtToday } from "@/lib/utils";
import type { PostPaydaySurgeRead } from "@/lib/ai/post-payday-surge";

// Post-payday surge — client widget mirroring TodaysFocusWidget. Surfaces
// only when ratio >= 1.4 AND inside a post-landing window. The brain
// computes both gates so the cached payload already carries `surface`.

type Props = {
  initial: PostPaydaySurgeRead | null;
  generatedAt: string | null;
  aiEnabled: boolean;
};

export function PostPaydaySurgeWidget({ initial, generatedAt, aiEnabled }: Props) {
  const [read, setRead] = useState<PostPaydaySurgeRead | null>(initial);
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
    void refreshPostPaydaySurge()
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
      const res = await refreshPostPaydaySurge({ force: true });
      if (res.ok) setRead(res.data);
    });
  };

  if (!read || !read.surface) return null;

  return (
    <div className="relative">
      <PostPaydaySurgeCard read={read} />
      <button
        type="button"
        onClick={handleRefresh}
        disabled={pending || loading}
        aria-label="Refresh post-payday read"
        className="absolute right-3 top-3 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
      >
        <RefreshCw className={pending || loading ? "h-2.5 w-2.5 animate-spin" : "h-2.5 w-2.5"} />
      </button>
    </div>
  );
}
