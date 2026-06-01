"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight, BookOpen, Clock, Compass, FileText, ReceiptText, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { YearMemoryRecall, YearRecallItem } from "@/lib/ai/year-memory-recall";

const KIND_META: Record<YearRecallItem["kind"], { label: string; Icon: LucideIcon }> = {
  letter:     { label: "Letter",    Icon: FileText },
  milestone:  { label: "Milestone", Icon: Sparkles },
  life_shift: { label: "Shift",     Icon: Compass },
  memory:     { label: "Memory",    Icon: BookOpen },
  payment:    { label: "Landed",    Icon: ArrowRight },
  spend:      { label: "Spent",     Icon: ReceiptText },
};

function formatRecallDate(iso: string): string {
  // Date-only strings (YYYY-MM-DD) get parsed; we only need month + day.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function YearMemoryRecallCard({ recall }: { recall: YearMemoryRecall | null }) {
  if (!recall) return null;
  return (
    <motion.section
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-[12px] border border-border/60 bg-card/30 px-3.5 py-3"
    >
      <header className="flex items-center gap-1.5">
        <Clock className="h-3 w-3 text-foreground/70" />
        <span className="text-[10px] uppercase tracking-[0.14em] text-foreground/70">
          One year ago · {formatRecallDate(recall.oneYearAgoDate)}
        </span>
      </header>
      <ul className="mt-2 flex flex-col gap-1.5">
        {recall.items.map((it, i) => {
          const meta = KIND_META[it.kind] ?? { label: it.kind, Icon: BookOpen };
          const Icon = meta.Icon;
          return (
            <li key={i} className="grid grid-cols-[14px_1fr] items-start gap-2 text-[12px] leading-snug">
              <Icon className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                {it.href ? (
                  <Link href={it.href} className="text-foreground underline-offset-4 hover:underline">
                    {it.label}
                  </Link>
                ) : (
                  <span className="text-foreground">{it.label}</span>
                )}
                {it.detail && (
                  <span className="ml-1 text-muted-foreground">· {it.detail.length > 100 ? `${it.detail.slice(0, 98)}…` : it.detail}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </motion.section>
  );
}
