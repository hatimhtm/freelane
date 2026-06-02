"use client";

import { useState, useTransition } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { rejectAutoDetected } from "@/lib/sadaka/auto-rules-actions";
import type { SadakaLedgerRow } from "@/lib/sadaka/ledger";
import type { CurrencyCode } from "@/lib/supabase/types";
import { phtDateString } from "@/lib/utils";

// ACTIVITY (S): last 5 ledger events. Tentative AI-classified rows get a
// "Not sadaka" reject affordance that archives + writes a denylist_note
// rule. Surface matches the Rhythm + AutoRules siblings on the same row:
// aspect-square, min-h-[160px], hover-lift ring — so the three S widgets
// stay visually uniform across breakpoints. List uses overflow-y-auto when
// 5 rows exceed the locked surface.

type Props = {
  events: SadakaLedgerRow[];
  currency: CurrencyCode;
};

const KIND_LABEL: Record<string, string> = {
  contribution: "Contribution",
  payment: "Marked",
  auto_detected: "Auto",
  decay: "Decay",
  adjustment: "Adjustment",
};

function KindIcon({ kind, tentative }: { kind: string; tentative: boolean }) {
  if (tentative) return <Sparkles className="h-3.5 w-3.5 text-[var(--brand)]" />;
  if (kind === "contribution") return <ArrowDownLeft className="h-3.5 w-3.5 text-foreground/60" />;
  if (kind === "decay") return <Clock className="h-3.5 w-3.5 text-foreground/40" />;
  return <ArrowUpRight className="h-3.5 w-3.5 text-foreground/60" />;
}

export function SadakaActivity({ events, currency }: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, start] = useTransition();
  const today = phtDateString(new Date());
  const visible = events.slice(0, 5);

  function onReject(id: string) {
    setPendingId(id);
    start(async () => {
      const res = await rejectAutoDetected(id);
      setPendingId(null);
      if (!res.ok) {
        toast.error(res.error || "Couldn't reject.");
        return;
      }
      toast.success("Marked not sadaka. The classifier just learned.");
    });
  }

  return (
    <div
      data-slot="card"
      className="group flex aspect-square w-full min-h-[160px] flex-col rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-8px_oklch(0_0_0/0.12)] md:col-span-1"
    >
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Activity
        </div>
        <div className="text-[10px] text-muted-foreground/70">last 5</div>
      </div>

      <div className="mt-2 flex flex-1 flex-col gap-2 overflow-y-auto">
        {visible.length === 0 && (
          <div className="text-[11.5px] text-muted-foreground">
            No events yet — the pool stays at zero until the first contribution lands.
          </div>
        )}
        {visible.map((ev) => {
          const ts = new Date(ev.event_at);
          const phtDay = phtDateString(ts);
          const dayLabel = phtDay === today ? "today" : phtDay;
          const amount = Math.abs(Number(ev.amount_base));
          const sign = Number(ev.amount_base) >= 0 ? "+" : "−";
          return (
            <div
              key={ev.id}
              className="flex items-start justify-between gap-2 border-b border-border/30 pb-2 last:border-b-0 last:pb-0"
            >
              <div className="flex items-start gap-1.5">
                <div className="mt-0.5">
                  <KindIcon kind={ev.kind} tentative={!!ev.tentative} />
                </div>
                <div className="min-w-0">
                  <div className="text-[11.5px] font-medium text-foreground">
                    {KIND_LABEL[ev.kind] ?? ev.kind}
                  </div>
                  <div className="truncate text-[10.5px] text-muted-foreground">
                    {ev.reasoning ?? ev.note ?? dayLabel}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="tabular-nums text-[11.5px] text-foreground">
                  {sign} {currency} {Math.round(amount)}
                </div>
                {ev.tentative && ev.kind === "auto_detected" && (
                  <button
                    type="button"
                    onClick={() => onReject(ev.id)}
                    disabled={pendingId === ev.id}
                    className="inline-flex items-center gap-0.5 rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
                  >
                    <X className="h-3 w-3" />
                    Not sadaka
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
