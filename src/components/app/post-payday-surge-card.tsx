"use client";

import { motion } from "motion/react";
import { ArrowDownLeft } from "lucide-react";
import type { PostPaydaySurgeRead } from "@/lib/ai/post-payday-surge";

// Post-payday Surge — fires after income lands. The canonical glyph for
// landed income is ArrowDownLeft (per the locked symbol vocabulary). Card
// chrome matches the widget primitive tokens: rounded-xl + ring-1 ring-foreground/10
// + bg-card so this stacks visually identical to YearMemoryRecallCard,
// EidPrepCard, TightModeCoach.

export function PostPaydaySurgeCard({ read }: { read: PostPaydaySurgeRead }) {
  if (!read || !read.surface || !read.line) return null;
  return (
    <motion.section
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-center gap-3 rounded-xl bg-card px-3.5 py-2.5 ring-1 ring-foreground/10"
    >
      <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-foreground/70" />
      <p className="text-sm leading-snug text-foreground">{read.line}</p>
    </motion.section>
  );
}
