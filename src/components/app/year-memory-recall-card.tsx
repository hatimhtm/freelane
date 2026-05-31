"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Clock } from "lucide-react";
import type { YearMemoryRecall } from "@/lib/ai/year-memory-recall";

const KIND_LABEL: Record<string, string> = {
  memory: "Memory",
  letter: "Letter",
  milestone: "Milestone",
  life_shift: "Shift",
  payment: "Landed",
  spend: "Spent",
};

export function YearMemoryRecallCard({ recall }: { recall: YearMemoryRecall | null }) {
  if (!recall) return null;
  return (
    <motion.section
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-[12px] border border-border/60 bg-card/30 px-3.5 py-3"
    >
      <header className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3 text-foreground/70" />
          <span className="text-[10px] uppercase tracking-[0.14em] text-foreground/70">
            One year ago today · {recall.oneYearAgoDate}
          </span>
        </div>
      </header>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {recall.items.map((it, i) => (
          <li key={i} className="text-[12px] leading-snug">
            <span className="rounded-full border border-border/60 bg-muted/30 px-1.5 text-[9px] uppercase tracking-wider text-muted-foreground">
              {KIND_LABEL[it.kind] ?? it.kind}
            </span>{" "}
            {it.href ? (
              <Link href={it.href} className="text-foreground underline-offset-4 hover:underline">
                {it.label}
              </Link>
            ) : (
              <span className="text-foreground">{it.label}</span>
            )}
            {it.detail && (
              <span className="ml-1 text-muted-foreground">· {it.detail.slice(0, 100)}</span>
            )}
          </li>
        ))}
      </ul>
    </motion.section>
  );
}
