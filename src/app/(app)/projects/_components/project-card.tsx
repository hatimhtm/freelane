"use client";

import { Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import type { Client, Payment, Project } from "@/lib/supabase/types";

export function ProjectCard({
  project,
  client,
  payments,
  onClick,
  dragging,
}: {
  project: Project;
  client?: Client;
  payments: Payment[];
  onClick?: () => void;
  dragging?: boolean;
}) {
  const paid = payments
    .filter((p) => p.currency === project.currency)
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const progress = Math.min(100, (paid / Math.max(1, Number(project.amount))) * 100);

  const dueDate = project.due_date ? new Date(project.due_date) : null;
  const today = new Date();
  const overdue = dueDate && dueDate < today && project.status !== "paid";

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      className={cn(
        "group cursor-pointer select-none rounded-lg border border-border/60 bg-card p-3 text-left shadow-sm transition-all hover:border-border hover:shadow-md",
        dragging && "cursor-grabbing shadow-2xl",
      )}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{project.title}</div>
          {client && (
            <div className="truncate text-xs text-muted-foreground">{client.name}</div>
          )}
        </div>
        <div className="shrink-0 text-right text-xs font-medium tabular">
          {formatMoney(Number(project.amount), project.currency)}
        </div>
      </div>

      {(project.status === "partially_paid" || paid > 0) && (
        <div className="mb-2 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[var(--chart-1)] to-[var(--chart-2)]"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {(project.tags?.length > 0 || dueDate) && (
        <div className="mt-2 flex items-center gap-1.5">
          {dueDate && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]",
                overdue
                  ? "bg-destructive/15 text-destructive"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <Calendar className="h-2.5 w-2.5" />
              {dueDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          )}
          {project.tags?.slice(0, 2).map((t) => (
            <span
              key={t}
              className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
