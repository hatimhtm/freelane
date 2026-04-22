"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/money";
import type { Client, Invoice, InvoiceStatus } from "@/lib/supabase/types";

const STATUS_TONE: Record<InvoiceStatus, string> = {
  draft:  "bg-muted text-muted-foreground",
  issued: "bg-[var(--chart-2)]/15 text-[var(--chart-2)]",
  sent:   "bg-[var(--chart-3)]/15 text-[var(--chart-3)]",
  paid:   "bg-[var(--chart-5)]/15 text-[var(--chart-5)]",
  void:   "bg-destructive/15 text-destructive",
};

export function InvoiceList({
  invoices,
  clientsById,
}: {
  invoices: Invoice[];
  clientsById: Map<string, Client>;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="divide-y divide-border/60">
        {invoices.map((inv, i) => {
          const client = clientsById.get(inv.client_id);
          return (
            <motion.div
              key={inv.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.02 }}
            >
              <Link
                href={`/invoices/${inv.id}`}
                className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-muted/40"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{inv.invoice_number}</span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium",
                          STATUS_TONE[inv.status],
                        )}
                      >
                        {inv.status}
                      </span>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {client?.name ?? "—"} · {new Date(inv.issue_date).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div className="text-sm font-medium tabular">
                  {formatMoney(Number(inv.total), inv.currency)}
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>
    </Card>
  );
}
