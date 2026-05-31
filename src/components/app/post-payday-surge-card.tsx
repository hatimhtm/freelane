"use client";

import { motion } from "motion/react";
import { Waves } from "lucide-react";
import type { PostPaydaySurgeRead } from "@/lib/ai/post-payday-surge";

export function PostPaydaySurgeCard({ read }: { read: PostPaydaySurgeRead }) {
  if (!read || !read.surface || !read.line) return null;
  return (
    <motion.section
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-center gap-3 rounded-[12px] border border-border/60 bg-card/30 px-3.5 py-2.5"
    >
      <Waves className="h-3.5 w-3.5 shrink-0 text-foreground/70" />
      <p className="text-sm leading-snug text-foreground">{read.line}</p>
    </motion.section>
  );
}
