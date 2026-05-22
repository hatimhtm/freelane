"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Flag, ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { flagProjectOverdue, unflagProjectOverdue } from "@/lib/data/actions";
import type { CurrencyCode } from "@/lib/supabase/types";

export type BlockedRow = {
  projectId: string;
  projectTitle: string;
  clientName: string;
  outstandingNative: number;
  currency: CurrencyCode;
  outstandingBase: number;
  daysAged: number;
  status: "unpaid" | "partially_paid";
  flagged: boolean;
};

// The "Blocked Money" list — every open balance, ranked by amount × days-aged.
// Linear-density rows. Replaces the kanban as the primary way to see what's
// owed. `interactive` adds the flag toggle + opens the project on click.
export function BlockedMoneyList({
  rows,
  baseCurrency,
  interactive = false,
  onOpen,
  limit,
}: {
  rows: BlockedRow[];
  baseCurrency: CurrencyCode;
  interactive?: boolean;
  onOpen?: (projectId: string) => void;
  limit?: number;
}) {
  const shown = limit ? rows.slice(0, limit) : rows;

  if (shown.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-card px-5 py-10 text-center text-sm text-muted-foreground">
        Nothing outstanding.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
      {shown.map((row, i) => (
        <Row
          key={row.projectId}
          row={row}
          baseCurrency={baseCurrency}
          interactive={interactive}
          onOpen={onOpen}
          last={i === shown.length - 1}
          index={i}
        />
      ))}
    </div>
  );
}

function Row({
  row,
  baseCurrency,
  interactive,
  onOpen,
  last,
  index,
}: {
  row: BlockedRow;
  baseCurrency: CurrencyCode;
  interactive: boolean;
  onOpen?: (projectId: string) => void;
  last: boolean;
  index: number;
}) {
  const [flagged, setFlagged] = useState(row.flagged);
  const [pending, start] = useTransition();
  const router = useRouter();

  function toggleFlag(e: React.MouseEvent) {
    e.stopPropagation();
    const next = !flagged;
    setFlagged(next);
    start(async () => {
      try {
        if (next) await flagProjectOverdue(row.projectId);
        else await unflagProjectOverdue(row.projectId);
      } catch (err) {
        setFlagged(!next);
        toast.error((err as Error).message);
      }
    });
  }

  const body = (
    <>
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          row.status === "partially_paid" ? "bg-[var(--chart-3)]" : "bg-muted-foreground/50",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{row.projectTitle}</div>
        <div className="truncate text-xs text-muted-foreground">{row.clientName}</div>
      </div>

      <div className="shrink-0">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] tabular",
            flagged
              ? "bg-[var(--overdue)]/12 text-[var(--overdue)]"
              : "bg-muted text-muted-foreground",
          )}
        >
          {row.daysAged}d
        </span>
      </div>

      <div className="shrink-0 text-right">
        <div className="text-sm font-semibold tabular">
          {formatMoney(row.outstandingNative, row.currency)}
        </div>
        {row.currency !== baseCurrency && (
          <div className="text-[11px] text-muted-foreground tabular">
            ≈ {formatMoney(row.outstandingBase, baseCurrency, { compact: true })}
          </div>
        )}
      </div>

      {interactive ? (
        <button
          type="button"
          onClick={toggleFlag}
          disabled={pending}
          aria-label={flagged ? "Clear overdue flag" : "Flag as overdue"}
          className={cn(
            "grid size-9 max-md:size-10 shrink-0 place-items-center rounded-md transition-colors",
            flagged
              ? "text-[var(--overdue)] hover:bg-[var(--overdue)]/10"
              : "text-muted-foreground/40 hover:bg-muted hover:text-foreground",
          )}
        >
          <Flag className={cn("size-3.5", flagged && "fill-current")} />
        </button>
      ) : (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/40" />
      )}
    </>
  );

  const className = cn(
    "flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40",
    !last && "border-b border-border/50",
  );

  const inner = body;

  const motionProps = {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.35, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] as const },
  };

  if (interactive && onOpen) {
    return (
      <motion.div
        {...motionProps}
        role="button"
        tabIndex={0}
        onClick={() => onOpen(row.projectId)}
        className={cn(className, "cursor-pointer")}
      >
        {inner}
      </motion.div>
    );
  }
  return (
    <motion.div
      {...motionProps}
      role="button"
      tabIndex={0}
      onClick={() => router.push("/projects")}
      className={cn(className, "cursor-pointer")}
    >
      {inner}
    </motion.div>
  );
}
