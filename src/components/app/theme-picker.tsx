"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Theme swatch grid for the appearance settings.
 *
 * Each theme is a complete palette applied via a `.theme-*` class on <html>
 * (next-themes, attribute="class"). The little previews below hardcode each
 * theme's actual bg / card / accent colors so the swatch matches the live UI.
 */
type ThemeDef = {
  value: string;
  label: string;
  hint: string;
  bg: string;
  card: string;
  accent: string;
};

export const THEMES: ThemeDef[] = [
  {
    value: "theme-graphite",
    label: "Graphite",
    hint: "Cool neutral dark",
    bg: "oklch(0.165 0 0)",
    card: "oklch(0.205 0 0)",
    accent: "oklch(0.92 0.22 124)",
  },
  {
    value: "theme-midnight",
    label: "Midnight",
    hint: "Deep indigo dark",
    bg: "oklch(0.17 0.035 264)",
    card: "oklch(0.215 0.04 264)",
    accent: "oklch(0.62 0.22 270)",
  },
  {
    value: "theme-slate",
    label: "Slate",
    hint: "Cool light",
    bg: "oklch(0.975 0.004 250)",
    card: "oklch(0.992 0.003 250)",
    accent: "oklch(0.55 0.16 255)",
  },
  {
    value: "theme-arctic",
    label: "Arctic",
    hint: "Crisp cool white",
    bg: "oklch(0.995 0.003 230)",
    card: "oklch(1 0 0)",
    accent: "oklch(0.62 0.18 235)",
  },
  {
    value: "theme-paper",
    label: "Paper",
    hint: "Warm editorial",
    bg: "oklch(0.974 0.007 84)",
    card: "oklch(0.987 0.005 84)",
    accent: "oklch(0.93 0.23 124)",
  },
  {
    value: "theme-carbon",
    label: "Carbon",
    hint: "Pure monochrome",
    bg: "oklch(0.12 0 0)",
    card: "oklch(0.16 0 0)",
    accent: "oklch(0.98 0 0)",
  },
];

export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {THEMES.map((t) => {
        const active = mounted && theme === t.value;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => setTheme(t.value)}
            aria-pressed={active}
            className={cn(
              "group relative flex flex-col items-start gap-3 rounded-xl border p-3 text-left transition-all",
              active
                ? "border-[var(--brand)] bg-[var(--brand)]/10"
                : "border-border/60 bg-muted/20 hover:border-border hover:bg-muted/40",
            )}
          >
            {/* Live-color preview: a tinted surface with a card chip + accent dot. */}
            <div
              className="relative flex h-16 w-full items-end gap-1.5 overflow-hidden rounded-md border p-2"
              style={{ backgroundColor: t.bg, borderColor: t.card }}
            >
              <div
                className="h-7 w-9 rounded-sm"
                style={{ backgroundColor: t.card }}
              />
              <div
                className="h-7 flex-1 rounded-sm opacity-60"
                style={{ backgroundColor: t.card }}
              />
              <div
                className="absolute right-2 top-2 h-3.5 w-3.5 rounded-full"
                style={{ backgroundColor: t.accent }}
              />
            </div>

            <div className="flex w-full items-center gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{t.label}</div>
                <div className="truncate text-xs text-muted-foreground">{t.hint}</div>
              </div>
              {active && (
                <Check className="ml-auto h-4 w-4 shrink-0 text-[var(--brand)]" />
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
