"use client";

import { Grid3x3 } from "lucide-react";
import { AiDot } from "@/components/widgets/ai-dot";

// Spend frequency heatmap — Behavior/L widget. Trailing-1y style GitHub
// grid: 7 rows (Sun..Sat) × N week columns, intensity bucketed against
// the scope's max-count day. PHT-bucketed upstream by getSpendFrequencyHeatmap.

export type SpendFrequencyHeatmapWidgetProps = {
  scope: string;
  data: { countsByDay: Record<string, number>; maxCount: number; days: string[] };
};

function intensityClass(count: number, max: number): string {
  if (count === 0) return "bg-foreground/[0.05]";
  const ratio = count / max;
  if (ratio < 0.2) return "bg-foreground/15";
  if (ratio < 0.45) return "bg-foreground/35";
  if (ratio < 0.7) return "bg-foreground/55";
  return "bg-foreground/80";
}

export function SpendFrequencyHeatmapWidget({
  scope,
  data,
}: SpendFrequencyHeatmapWidgetProps) {
  const cardKey = `stats.${scope}.spend_frequency_heatmap`;
  const sortedDays = [...data.days].sort();
  if (sortedDays.length === 0) return null;
  const start = new Date(`${sortedDays[0]}T00:00:00+08:00`);
  const end = new Date(`${sortedDays[sortedDays.length - 1]}T00:00:00+08:00`);
  // Build a column-major list of week columns from the first Sunday on or
  // before start to the last Saturday on or after end.
  const startDow = start.getUTCDay(); // 0=Sun
  const firstCol = new Date(start.getTime() - startDow * 86_400_000);
  const endDow = end.getUTCDay();
  const lastCol = new Date(end.getTime() + (6 - endDow) * 86_400_000);
  const columns: Array<Array<{ dateStr: string; count: number }>> = [];
  let cursor = new Date(firstCol);
  while (cursor.getTime() <= lastCol.getTime()) {
    const col: Array<{ dateStr: string; count: number }> = [];
    for (let i = 0; i < 7; i += 1) {
      const day = new Date(cursor.getTime() + i * 86_400_000);
      const y = day.getUTCFullYear();
      const m = String(day.getUTCMonth() + 1).padStart(2, "0");
      const d = String(day.getUTCDate()).padStart(2, "0");
      const dateStr = `${y}-${m}-${d}`;
      col.push({ dateStr, count: data.countsByDay[dateStr] ?? 0 });
    }
    columns.push(col);
    cursor = new Date(cursor.getTime() + 7 * 86_400_000);
  }
  const totalSpendDays = sortedDays.length;
  return (
    <div className="group relative flex min-h-[200px] w-full flex-col rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start gap-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground/[0.04] text-foreground/70">
          <Grid3x3 className="h-4 w-4" />
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Spend frequency
        </div>
      </div>
      <div className="mt-3 text-[12px] text-muted-foreground">
        {totalSpendDays} active {totalSpendDays === 1 ? "day" : "days"} · peak{" "}
        {data.maxCount} on the busiest day
      </div>
      <div className="mt-3 overflow-x-auto pb-1">
        <div className="flex gap-[3px]">
          {columns.map((col, i) => (
            <div key={i} className="flex flex-col gap-[3px]">
              {col.map((cell) => (
                <div
                  key={cell.dateStr}
                  title={`${cell.dateStr}: ${cell.count}`}
                  className={`h-2.5 w-2.5 rounded-[2px] ${intensityClass(
                    cell.count,
                    data.maxCount,
                  )}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <AiDot
        card={{
          key: cardKey,
          label: "Spend frequency heatmap",
          data: { scope, active_days: totalSpendDays, max_count: data.maxCount },
        }}
        question="What's the rhythm look like?"
      />
    </div>
  );
}
