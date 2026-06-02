import { Moon } from "lucide-react";
import type { LateNightClusterRead } from "@/lib/ai/late-night-cluster";

// T27 — Night spends remark. A single editorial line (no card chrome).
// Modular-relevance-gated: hides on no surface.

export function NightSpendsRemark({ read }: { read: LateNightClusterRead | null }) {
  if (!read || !read.surface || !read.line) return null;
  return (
    <p className="flex items-baseline gap-2 text-[12.5px] leading-snug text-muted-foreground">
      <Moon className="h-3 w-3 shrink-0 translate-y-px text-foreground/50" />
      <span>{read.line}</span>
    </p>
  );
}
