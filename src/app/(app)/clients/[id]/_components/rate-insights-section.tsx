"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, RefreshCw, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteRateInsightAction,
  markRateInsightActedAction,
  replyToRateInsightAction,
  runRateInsightSweepAction,
} from "@/lib/data/actions";
import { cn } from "@/lib/utils";
import type { RateInsight } from "@/lib/supabase/types";

const KIND_LABEL: Record<string, string> = {
  scope_creep: "Scope creep",
  revision_burden: "Revision burden",
  communication_lag: "Comms lag",
  rate_lag: "Rate lag",
  underpriced_relative_to_market: "Underpriced",
  overpriced_relative_to_outcomes: "Outcomes < price",
  time_spent_unaccounted: "Time slip",
  general: "Observation",
};

function formatGen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function RateInsightsSection({ insights }: { insights: RateInsight[] }) {
  const router = useRouter();
  const [sweeping, startSweep] = useTransition();

  return (
    <section>
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h2 className="text-sm font-medium">Rate signals</h2>
          <p className="text-xs text-muted-foreground">Friction the AI noticed in past projects with this client.</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={sweeping}
          onClick={() =>
            startSweep(async () => {
              try {
                const out = await runRateInsightSweepAction();
                toast.success(out.generated > 0 ? `${out.generated} new signal${out.generated === 1 ? "" : "s"}` : "Nothing surfaced.");
                router.refresh();
              } catch (err) {
                toast.error((err as Error).message);
              }
            })
          }
          className="gap-1.5"
        >
          <RefreshCw className={cn("h-3 w-3", sweeping && "animate-spin")} />
          {sweeping ? "Reading…" : "Sweep"}
        </Button>
      </div>

      {insights.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 px-3 py-5 text-center text-xs text-muted-foreground">
          No signals yet. Sweep to read the last 6 projects.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {insights.map((ri) => (
            <InsightRow key={ri.id} insight={ri} />
          ))}
        </ul>
      )}
    </section>
  );
}

function InsightRow({ insight }: { insight: RateInsight }) {
  const router = useRouter();
  const [reply, setReply] = useState(insight.reply ?? "");
  const [pending, start] = useTransition();
  const replied = !!insight.replied_at;

  return (
    <li
      className={cn(
        "rounded-md border bg-card/40 p-3",
        insight.acted ? "border-acid-lime/40 bg-acid-lime/[0.04]" : "border-border/60",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          {KIND_LABEL[insight.kind] ?? insight.kind}
        </span>
        <span className="text-[10px] tabular text-muted-foreground/70">
          {formatGen(insight.generated_at)}
        </span>
      </div>
      <p className="mt-1.5 text-sm leading-snug text-foreground">{insight.observation}</p>

      {!replied && (
        <Textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="A line of context — folds into memory."
          rows={2}
          className="mt-2 resize-none text-sm"
        />
      )}
      {replied && insight.reply && (
        <p className="mt-2 rounded border border-border/40 bg-muted/30 px-2.5 py-1.5 text-[12px] leading-relaxed text-foreground/85">
          <span className="font-medium">Your note · </span>{insight.reply}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center justify-end gap-1.5">
        {!replied && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !reply.trim()}
            onClick={() =>
              start(async () => {
                try {
                  await replyToRateInsightAction({ rateInsightId: insight.id, reply: reply.trim() });
                  toast.success("Folded into memory.");
                  router.refresh();
                } catch (err) {
                  toast.error((err as Error).message);
                }
              })
            }
            className="gap-1.5"
          >
            <Send className="h-3 w-3" />
            {pending ? "Saving…" : "Reply"}
          </Button>
        )}
        <Button
          size="sm"
          variant={insight.acted ? "default" : "outline"}
          disabled={pending}
          onClick={() =>
            start(async () => {
              try {
                await markRateInsightActedAction(insight.id, !insight.acted);
                toast.success(insight.acted ? "Unmarked." : "Marked acted.");
                router.refresh();
              } catch (err) {
                toast.error((err as Error).message);
              }
            })
          }
          className="gap-1.5"
        >
          <Check className="h-3 w-3" />
          {insight.acted ? "Acted" : "Mark acted"}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Delete signal"
          disabled={pending}
          onClick={() =>
            start(async () => {
              try {
                await deleteRateInsightAction(insight.id);
                toast.success("Removed.");
                router.refresh();
              } catch (err) {
                toast.error((err as Error).message);
              }
            })
          }
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}
