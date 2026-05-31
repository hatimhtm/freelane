"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { CenterModal, CenterModalBody } from "@/components/ui/center-modal";
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
      <CenterModal
        open={isOpen}
        onOpenChange={(o) => setIsOpen(o)}
        title={meta?.title ?? "Metric"}
        description={meta?.description}
        size="lg"
      >
        <CenterModalBody>
          {activeKey && (
            <Link
              href={`/metric/${activeKey}`}
              className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Open full page <ArrowUpRight className="size-3" />
            </Link>
          )}
          {data ? <MetricDetailBody data={data} /> : <MetricSheetSkeleton />}
        </CenterModalBody>
      </CenterModal>
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
