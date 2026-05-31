"use client";

import { AnimatePresence, motion } from "motion/react";
import type { SuggestedTag } from "@/lib/ai/tag-suggest";
import type { SpendCategory } from "@/lib/supabase/types";

const EASE = [0.22, 1, 0.36, 1] as const;

export function TagSuggestStrip({
  suggestions,
  categories,
  onAccept,
}: {
  suggestions: SuggestedTag[];
  categories: SpendCategory[];
  onAccept: (categoryId: string) => void;
}) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const visible = suggestions
    .map((s) => ({ tag: s, category: byId.get(s.categoryId) }))
    .filter((x): x is { tag: SuggestedTag; category: SpendCategory } => Boolean(x.category))
    .slice(0, 3);

  if (visible.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      <AnimatePresence initial={false} mode="popLayout">
        {visible.map(({ category }, i) => {
          const top = i === 0;
          return (
            <motion.button
              key={category.id}
              type="button"
              onClick={() => onAccept(category.id)}
              layout
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: -2 }}
              transition={{ duration: 0.28, ease: EASE }}
              className={
                top
                  ? "rounded-full border-[1.5px] border-[var(--brand)]/60 px-3 py-1.5 text-[13px] font-medium text-ink transition-colors duration-300 ease-out hover:bg-[var(--brand)]/12"
                  : "rounded-full border-[1.5px] border-ink/30 px-3 py-1.5 text-[13px] font-medium text-ink transition-colors duration-300 ease-out hover:bg-ink/[0.06]"
              }
            >
              {category.name}
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
