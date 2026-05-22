"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { MetricDetailBody, type MetricData } from "@/app/(app)/metric/[key]/_components/metric-detail";
import { getMetricData } from "@/lib/data/metric-actions";
import { cn } from "@/lib/utils";
import type { MetricKey } from "@/lib/metric-data";

// Titles live here (not imported from the server-only metric-data module) so
// this client bundle never pulls in the data-layer code.
const META: Record<MetricKey, { title: string; description: string }> = {
  landed: { title: "Landed this month", description: "Cash that arrived this month — locked at the rate it landed." },
  outstanding: { title: "Outstanding", description: "Every open balance you're still owed, at today's rates." },
  fees: { title: "Fees", description: "What the rails and FX markup ate — by month, chain, and worst offenders." },
  "avg-days": { title: "Avg days to payment", description: "How long a quote takes to turn into the first payment." },
  debtor: { title: "Biggest debtor", description: "Clients ranked by how much they currently owe you." },
};

type Ctx = {
  open: (key: MetricKey) => void;
  prefetch: (key: MetricKey) => void;
};

const MetricSheetContext = createContext<Ctx | null>(null);

export function useMetricSheet() {
  const ctx = useContext(MetricSheetContext);
  if (!ctx) throw new Error("useMetricSheet must be used inside MetricSheetProvider");
  return ctx;
}

export function MetricSheetProvider({ children }: { children: React.ReactNode }) {
  const [activeKey, setActiveKey] = useState<MetricKey | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [cache, setCache] = useState<Partial<Record<MetricKey, MetricData>>>({});
  const inflight = useRef<Set<MetricKey>>(new Set());
  const pathname = usePathname();

  const load = useCallback(
    (key: MetricKey) => {
      if (cache[key] || inflight.current.has(key)) return;
      inflight.current.add(key);
      getMetricData(key)
        .then((data) => setCache((c) => ({ ...c, [key]: data })))
        .catch(() => {})
        .finally(() => inflight.current.delete(key));
    },
    [cache],
  );

  const prefetch = useCallback((key: MetricKey) => load(key), [load]);

  const open = useCallback(
    (key: MetricKey) => {
      setActiveKey(key);
      setIsOpen(true);
      load(key);
    },
    [load],
  );

  // Close when the route changes (e.g. the user clicked "Open full page").
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  const data = activeKey ? cache[activeKey] : undefined;
  const meta = activeKey ? META[activeKey] : null;

  return (
    <MetricSheetContext.Provider value={{ open, prefetch }}>
      {children}
      <Sheet open={isOpen} onOpenChange={(o) => setIsOpen(o)}>
        <SheetContent
          side="right"
          className="w-full gap-0 overflow-x-hidden p-0 sm:max-w-none sm:w-[94vw] md:w-[78vw] lg:w-[56vw] xl:w-[50vw]"
        >
          <div className="sticky top-0 z-10 border-b border-border/60 bg-popover/85 px-5 py-4 backdrop-blur-xl sm:px-7">
            <div className="display-eyebrow text-muted-foreground">Metric</div>
            <h2 className="display-headline mt-1 text-xl">{meta?.title ?? "Metric"}</h2>
            {meta && <p className="mt-1 text-sm text-muted-foreground">{meta.description}</p>}
            {activeKey && (
              <Link
                href={`/metric/${activeKey}`}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Open full page <ArrowUpRight className="size-3" />
              </Link>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 pb-12 pt-6 sm:px-7">
            {data ? <MetricDetailBody data={data} /> : <MetricSheetSkeleton />}
          </div>
        </SheetContent>
      </Sheet>
    </MetricSheetContext.Provider>
  );
}

function MetricSheetSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-14 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-48 w-full rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}

// Wrap any card/figure to open its metric in the side sheet. Prefetches the
// data on hover/focus so the panel is already populated by the time it opens.
export function MetricTrigger({
  metricKey,
  children,
  className,
}: {
  metricKey: MetricKey;
  children: React.ReactNode;
  className?: string;
}) {
  const { open, prefetch } = useMetricSheet();
  return (
    <button
      type="button"
      onClick={() => open(metricKey)}
      onMouseEnter={() => prefetch(metricKey)}
      onFocus={() => prefetch(metricKey)}
      className={cn("block w-full cursor-pointer text-left", className)}
    >
      {children}
    </button>
  );
}
