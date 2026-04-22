"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { Bell, Check, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import type { Client, CurrencyCode, Invoice } from "@/lib/supabase/types";
import { markInvoiceReminded } from "@/lib/data/actions";

type ReminderItem = {
  invoice: Invoice;
  client?: Client;
  ageDays: number;
};

export function RemindersWidget({ items }: { items: ReminderItem[] }) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  const visible = items.filter((it) => !dismissed.has(it.invoice.id));
  if (visible.length === 0) return null;

  function onDismiss(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    start(async () => {
      try {
        await markInvoiceReminded(id);
        toast.success("Marked as followed up");
        router.refresh();
      } catch (err: unknown) {
        toast.error((err as Error).message);
        setDismissed((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className="overflow-hidden border-[var(--chart-3)]/30 p-0">
        <div className="flex items-center justify-between border-b border-border/60 bg-[var(--chart-3)]/8 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--chart-3)]/15">
              <Bell className="h-3.5 w-3.5 text-[var(--chart-3)]" />
            </span>
            <div className="text-sm font-medium">
              {visible.length} invoice{visible.length === 1 ? "" : "s"} to chase
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Unpaid beyond your reminder window
          </div>
        </div>

        <ul className="divide-y divide-border/60">
          <AnimatePresence initial={false}>
            {visible.map((it) => (
              <motion.li
                key={it.invoice.id}
                layout
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 6, height: 0 }}
                transition={{ duration: 0.25 }}
                className="flex items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span>{it.invoice.invoice_number}</span>
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground tabular">
                      {it.ageDays}d
                    </span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {it.client?.name ?? "—"} ·{" "}
                    <span className="tabular">
                      {formatMoney(Number(it.invoice.total), it.invoice.currency as CurrencyCode)}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Open invoice"
                    render={<Link href={`/invoices/${it.invoice.id}`} />}
                    nativeButton={false}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-[var(--chart-5)]"
                    aria-label="Mark as followed up"
                    onClick={() => onDismiss(it.invoice.id)}
                    disabled={pending}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </Card>
    </motion.div>
  );
}
