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

// Terracotta darker text shade — used by warning pills on terracotta-toned
// surfaces (client-widget pattern_changed pill, pattern-change-history
// timeline dot). Keeps the literal off the call sites so the next palette
// shift updates here once.
export const TERRACOTTA_TEXT = "oklch(0.55 0.16 45)";
export const TERRACOTTA_TEXT_CLASS = "text-[oklch(0.55_0.16_45)]";
export const TERRACOTTA_BG_CLASS = "bg-[oklch(0.7_0.13_45)]/12";
export const TERRACOTTA_DOT_CLASS = "bg-[oklch(0.7_0.13_45)]";

// Quiet-channel / muted-pill tokens. The pill is the only signal carrying
// quiet_14d (the ring tone is suppressed on client-widget), so the colours
// need to stay loud enough to read while still feeling "this client has
// gone quiet" rather than "this client is in trouble".
export const QUIET_PILL_BG_CLASS = "bg-foreground/[0.06]";
export const QUIET_PILL_TEXT_CLASS = "text-muted-foreground";
export const QUIET_PILL_RING_CLASS = "ring-foreground/10";

// Overdue (rose) — escalation tone. Pill + ring shared between client
// widget overdue chips and any other surface that needs to flag urgency.
export const OVERDUE_BG_CLASS = "bg-rose-500/12";
export const OVERDUE_TEXT_CLASS = "text-rose-600";
export const OVERDUE_RING_CLASS = "ring-rose-500/30";
