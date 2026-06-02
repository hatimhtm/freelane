// Locked palette token literals — paper + ink base + 4 semantic accents.
// Re-export these strings everywhere the inline oklch tuples used to live
// (s-widget, m-widget, calm-weather-banner, notifications-popover, etc.) so
// the literal value lives once. Importable from client + server modules.
//
// Why not Tailwind tokens: Tailwind 4 already has --brand declared in
// globals.css, but the JIT class arbitrary-value form `bg-[var(--brand)]`
// drops the OKLCH fallback when the CSS variable is missing in a server
// context. Keeping JS constants gives every consumer the exact same string
// so swatches and class names stay in lockstep.

export const BRAND_LIME = "oklch(0.85 0.18 120)";
export const TERRACOTTA = "oklch(0.7 0.13 45)";

// Tailwind arbitrary-value forms — saves callers from re-templating the
// oklch tuple at every use site. Spaces become underscores per Tailwind 4.
export const BRAND_LIME_CLASS = "bg-[oklch(0.85_0.18_120)]";
export const TERRACOTTA_CLASS = "bg-[oklch(0.7_0.13_45)]";
export const TERRACOTTA_RING_CLASS = "ring-[oklch(0.7_0.13_45)]/30";
export const BRAND_LIME_RING_CLASS = "ring-[oklch(0.85_0.18_120)]/30";

// Var-with-fallback form — preferred when the consumer wants user theming
// (via --brand override) but still needs the literal fallback when the
// variable is missing (e.g. server-rendered first paint before themes load).
export const BRAND_LIME_VAR_CLASS = "bg-[var(--brand,oklch(0.85_0.18_120))]";
