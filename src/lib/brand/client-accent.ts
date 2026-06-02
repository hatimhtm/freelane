import type { CSSProperties } from "react";

// Deterministic client-accent resolver.
//
// Why this exists: the Clients workflow restyles client cards onto the M
// widget shell. Each client needs a stable accent (avatar gradient base +
// soft fill) that NEVER drifts across renders. A random hue per render
// would feel chaotic; a hash-band keeps things warm + consistent.
//
// Per the freelane-brand-identity memory: client accents live in the
// warm-hue band (15° terracotta → 60° amber). Fixed L=0.66, C=0.18 keeps
// the saturation/lightness predictable across the band so two adjacent
// cards never clash. Manual override via clients.color_hex hooks in via
// resolveClientAccent's `override` arg (future-proofing — the column
// doesn't exist on the table today).
//
// This file is a PURE module: no "use server", no "import server-only".
// It runs on the server during list rendering AND on the client in the
// widget. The FNV-1a math is duplicated from src/lib/ai/cache.ts on
// purpose — that file is "use server" and can't be imported from a
// client-rendered widget.

const WARM_HUE_LO = 15;
const WARM_HUE_HI = 60; // inclusive — band width 46° (15..60)
const WARM_BAND = WARM_HUE_HI - WARM_HUE_LO + 1;
const L = 0.66;
const C = 0.18;

export type ClientAccent = {
  base: string; // oklch() — full saturation accent
  soft: string; // 12% alpha — card surface tint
  text: string; // legible foreground on the soft tint
  hex: string; // approximate hex (for icons / og images)
};

// FNV-1a 32-bit. Duplicated from cache.ts (which is "use server") so this
// module can stay pure + client-importable. Stable across Node + browser.
function fnv1aHex(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function hashToHue(input: string): number {
  const h = fnv1aHex(input);
  // Convert hex tail to int. 6 hex chars = 24 bits, plenty for modulo.
  const n = parseInt(h.slice(-6), 16);
  return WARM_HUE_LO + (n % WARM_BAND);
}

// Cheap oklch → approximate hex via a tiny conversion. The widget mostly
// uses the oklch strings directly; hex is for og: + non-color-managed
// surfaces. Not perceptually exact — close enough for an icon background.
function oklchToHex(l: number, c: number, h: number): string {
  // OKLCH → OKLab
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  // OKLab → linear sRGB (matrix from the OKLab spec).
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const lr = l_ * l_ * l_;
  const mr = m_ * m_ * m_;
  const sr = s_ * s_ * s_;
  let r = 4.0767416621 * lr - 3.3077115913 * mr + 0.2309699292 * sr;
  let g = -1.2684380046 * lr + 2.6097574011 * mr - 0.3413193965 * sr;
  let bl = -0.0041960863 * lr - 0.7034186147 * mr + 1.707614701 * sr;
  // Gamma-correct linear → sRGB, then clamp.
  const toSrgb = (x: number) =>
    x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
  r = Math.max(0, Math.min(1, toSrgb(r)));
  g = Math.max(0, Math.min(1, toSrgb(g)));
  bl = Math.max(0, Math.min(1, toSrgb(bl)));
  const hex = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(bl)}`;
}

// Resolve an accent for a client. `seed` is anything stable (id or name);
// id is preferred so renames don't recolor the avatar. `override` skips
// the hash entirely — wire it up once clients gain a color_hex column.
export function resolveClientAccent(
  seed: string,
  override?: string | null,
): ClientAccent {
  if (override && /^#?[0-9a-fA-F]{6}$/.test(override.replace(/^#/, ""))) {
    const hex = override.startsWith("#") ? override : `#${override}`;
    // Override path can't easily round-trip back to oklch without colorspace
    // math we don't need here. Use the hex everywhere; the soft tint is the
    // hex at 19/255 alpha (≈ 12%). Adequate fallback for a manual choice.
    return {
      base: hex,
      soft: `${hex}1f`,
      text: hex,
      hex,
    };
  }
  const hue = hashToHue(seed);
  const base = `oklch(${L} ${C} ${hue})`;
  const soft = `oklch(${L} ${C} ${hue} / 0.12)`;
  const text = `oklch(${(L - 0.18).toFixed(2)} ${C} ${hue})`;
  return {
    base,
    soft,
    text,
    hex: oklchToHex(L, C, hue),
  };
}

// Helper for the widget: tuple of inline styles for the avatar circle.
// Returns a record with `--client-accent` + `--client-accent-soft` so the
// widget can read both with one spread.
export function clientAccentStyles(seed: string, override?: string | null) {
  const a = resolveClientAccent(seed, override);
  return {
    "--client-accent": a.base,
    "--client-accent-soft": a.soft,
    "--client-accent-text": a.text,
  } as CSSProperties;
}
