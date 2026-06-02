"use client";

import Link from "next/link";
import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { motion } from "motion/react";
import { refreshCalmWeatherAction } from "@/lib/data/actions";
import { cn } from "@/lib/utils";
import { BRAND_LIME_CLASS, TERRACOTTA_CLASS } from "@/lib/design/tokens";
import type {
  CalmWeatherBand,
  CalmWeatherState,
} from "@/lib/supabase/types";

// The OS-wide weather line. The whole point per Hatim: ONE honest read of
// "where am I today?" rendered identically on every surface that needs it.
// Renders nothing until the state row exists; the brain regenerates on read
// when stale so we don't need a poller here.
//
// Layout: small band-coloured dot + narrative + optional secondary line +
// recommendation chips. Compact enough to live above the Today hero AND
// inside the dashboard's top section.

// 5 bands mapped onto the 4 locked semantic colours (slate-muted, lime,
// terracotta, rose). No --overdue alias, no acid-lime ring stack — the
// previous version added a fifth "bg-foreground/55" tint and a ring-on-ring
// glyph for calm_after that drifted outside the palette. New mapping:
//   still      → slate-muted dot (default quiet)
//   breeze     → slate-muted dot (watchful but calm)
//   gust       → terracotta (warm attention)
//   storm      → rose (alarm)
//   calm_after → lime (positive completion)
const BAND_RING: Record<CalmWeatherBand, string> = {
  still: "bg-foreground/25",
  breeze: "bg-foreground/45",
  gust: TERRACOTTA_CLASS,
  storm: "bg-rose-500",
  calm_after: BRAND_LIME_CLASS,
};

const BAND_LABEL: Record<CalmWeatherBand, string> = {
  still: "Still",
  breeze: "Breeze",
  gust: "Gust",
  storm: "Storm",
  calm_after: "After the storm",
};

const KIND_HREF: Record<string, string> = {
  pre_mortem: "/plans",
  lock: "/plans",
  review: "/settings",
  log: "/spending?new=1",
  tight_open: "/today#tight-mode",
  breathe: "/today",
};

export function CalmWeatherBanner({
  state,
  variant = "today",
}: {
  state: CalmWeatherState | null;
  variant?: "today" | "dashboard";
}) {
  const [pending, start] = useTransition();
  if (!state) return null;

  const dotClass = BAND_RING[state.band];

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        // rounded-xl + ring-1 ring-foreground/10 matches the locked widget
        // primitives so every Today/Dashboard card has the same radius +
        // edge treatment.
        "flex flex-col gap-2 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cn("mt-2 h-2.5 w-2.5 shrink-0 rounded-full", dotClass)}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-foreground/70">
              {BAND_LABEL[state.band]}
            </span>
            <button
              type="button"
              onClick={() => start(() => refreshCalmWeatherAction())}
              disabled={pending}
              aria-label="Refresh the weather read"
              className="text-muted-foreground/70 hover:text-foreground/80 disabled:opacity-40"
            >
              <RefreshCw className={cn("h-3 w-3", pending && "animate-spin")} />
            </button>
          </div>
          <p className="mt-0.5 font-display text-[15px] leading-snug text-foreground">
            {state.narrative}
          </p>
          {state.secondary && (
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              {state.secondary}
            </p>
          )}
        </div>
      </div>

      {state.recommendations.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {state.recommendations.slice(0, 3).map((rec, i) => {
            const href = rec.cta_route ?? KIND_HREF[rec.kind] ?? "/today";
            const params = rec.cta_params
              ? `?${new URLSearchParams(rec.cta_params).toString()}`
              : "";
            return (
              <Link
                key={i}
                href={`${href}${params}`}
                className="rounded-full border border-border/70 px-2.5 py-1 text-[11px] text-foreground/80 transition-colors hover:border-foreground/40 hover:bg-muted/40"
              >
                {rec.label}
              </Link>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
