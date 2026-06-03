import type { CSSProperties } from "react";

// Deterministic entity-accent resolver.
//
// Why this exists: the People sub-tab (formerly /entities) restyles entity
// cards onto the M widget shell. Each entity needs a stable accent
// (avatar gradient base + soft fill) that never drifts across renders.
// Mirrors the Clients warm-band hash from src/lib/brand/client-accent.ts
// so /clients and /clients/people share the same visual language —
// per freelane-brand-identity (extended on 2026-06-03 to cover entities).
//
// Both files are PURE modules (no "use server", no "import server-only").
// Duplicated rather than imported because client-accent.ts is the source
// of truth for the client cohort; sharing the helper would imply the
// palettes track together, which they DON'T — future Brand Identity
// tweaks may differentiate them (e.g. clients lean amber, entities lean
// terracotta) and the duplication keeps that lever ready.

const WARM_HUE_LO = 15;
const WARM_HUE_HI = 60; // inclusive — band width 46° (15..60)
const WARM_BAND = WARM_HUE_HI - WARM_HUE_LO + 1;
const L = 0.66;
const C = 0.18;

export type EntityAccent = {
  base: string; // oklch() — full saturation accent
  soft: string; // 12% alpha — card surface tint
  text: string; // legible foreground on the soft tint
  hex: string; // approximate hex (for icons / og images)
};

// FNV-1a 32-bit. Duplicated for the same reason client-accent duplicates
// it: this module is client-importable and the cache.ts copy is
// "use server".
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
  const n = parseInt(h.slice(-6), 16);
  return WARM_HUE_LO + (n % WARM_BAND);
}

function oklchToHex(l: number, c: number, h: number): string {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const lr = l_ * l_ * l_;
  const mr = m_ * m_ * m_;
  const sr = s_ * s_ * s_;
  let r = 4.0767416621 * lr - 3.3077115913 * mr + 0.2309699292 * sr;
  let g = -1.2684380046 * lr + 2.6097574011 * mr - 0.3413193965 * sr;
  let bl = -0.0041960863 * lr - 0.7034186147 * mr + 1.707614701 * sr;
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

export function resolveEntityAccent(
  seed: string,
  override?: string | null,
): EntityAccent {
  if (override && /^#?[0-9a-fA-F]{6}$/.test(override.replace(/^#/, ""))) {
    const hex = override.startsWith("#") ? override : `#${override}`;
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

export function entityAccentStyles(seed: string, override?: string | null) {
  const a = resolveEntityAccent(seed, override);
  return {
    "--entity-accent": a.base,
    "--entity-accent-soft": a.soft,
    "--entity-accent-text": a.text,
  } as CSSProperties;
}
