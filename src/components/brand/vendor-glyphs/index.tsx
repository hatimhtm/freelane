import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

// Stylized SVG glyphs for ~30 curated PH vendors. Each is a 32x32 viewBox
// with a tinted rounded background + an abstract / letterform mark.
// NOT literal corporate logos — letterforms, geometric motifs, or
// category icons. Indexed by curated slug from src/lib/brand/vendors.ts.

export type VendorGlyphProps = {
  className?: string;
  ariaLabel?: string;
};

export type VendorGlyphComponent = (props: VendorGlyphProps) => ReactElement;

// Compact factory for "letter on a tinted tile" glyphs — the majority of
// the curated set. Keeps the file from sprawling into 30 near-identical
// SVG components. Pass through className for size scaling.
function makeLetterGlyph(
  letter: string,
  bg: string,
  fg: string,
  defaultLabel: string,
): VendorGlyphComponent {
  const Glyph: VendorGlyphComponent = ({ className, ariaLabel }) => (
    <svg
      viewBox="0 0 32 32"
      className={cn("shrink-0", className)}
      role="img"
      aria-label={ariaLabel ?? defaultLabel}
    >
      <rect width="32" height="32" rx="8" fill={bg} fillOpacity={0.18} />
      <text
        x="16"
        y="17"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontWeight={700}
        fontSize={letter.length > 1 ? 11 : 14}
        fill={fg}
        letterSpacing={letter.length > 1 ? "-0.04em" : "0"}
      >
        {letter}
      </text>
    </svg>
  );
  return Glyph;
}

// One-off glyphs that benefit from a small geometric mark instead of a
// raw letterform. Defined inline for clarity.
const ShopeeGlyph: VendorGlyphComponent = ({ className, ariaLabel }) => (
  <svg viewBox="0 0 32 32" className={cn("shrink-0", className)} role="img" aria-label={ariaLabel ?? "Shopee"}>
    <rect width="32" height="32" rx="8" fill="#EE4D2D" fillOpacity={0.18} />
    <path
      d="M11 13 H21 L20 23 H12 Z"
      fill="none"
      stroke="#EE4D2D"
      strokeWidth={1.4}
      strokeLinejoin="round"
    />
    <path
      d="M13 13 V11 a3 3 0 0 1 6 0 V13"
      fill="none"
      stroke="#EE4D2D"
      strokeWidth={1.4}
      strokeLinecap="round"
    />
  </svg>
);

const GrabGlyph: VendorGlyphComponent = ({ className, ariaLabel }) => (
  <svg viewBox="0 0 32 32" className={cn("shrink-0", className)} role="img" aria-label={ariaLabel ?? "Grab"}>
    <rect width="32" height="32" rx="8" fill="#00B14F" fillOpacity={0.18} />
    <circle cx="16" cy="16" r="6" fill="none" stroke="#00B14F" strokeWidth={1.6} />
    <circle cx="16" cy="16" r="2" fill="#00B14F" />
  </svg>
);

const JeepneyGlyph: VendorGlyphComponent = ({ className, ariaLabel }) => (
  <svg viewBox="0 0 32 32" className={cn("shrink-0", className)} role="img" aria-label={ariaLabel ?? "Jeepney"}>
    <rect width="32" height="32" rx="8" fill="oklch(0.55 0.18 25)" fillOpacity={0.14} />
    <rect x="6" y="13" width="20" height="7" rx="2" fill="none" stroke="oklch(0.40 0.13 25)" strokeWidth={1.3} />
    <circle cx="11" cy="22" r="2" fill="oklch(0.40 0.13 25)" />
    <circle cx="21" cy="22" r="2" fill="oklch(0.40 0.13 25)" />
  </svg>
);

const LbcGlyph: VendorGlyphComponent = ({ className, ariaLabel }) => (
  <svg viewBox="0 0 32 32" className={cn("shrink-0", className)} role="img" aria-label={ariaLabel ?? "LBC"}>
    <rect width="32" height="32" rx="8" fill="#E11D2A" fillOpacity={0.18} />
    <rect x="7" y="11" width="18" height="11" rx="2" fill="none" stroke="#E11D2A" strokeWidth={1.4} />
    <line x1="7" y1="15" x2="25" y2="15" stroke="#E11D2A" strokeWidth={1.2} />
  </svg>
);

// ───────────────────────────────────────── Curated map ──
//
// Slug → glyph component. The slug is the canonical key callers use to
// look up a glyph — same form as vendorSlug in src/lib/spending/vendor-
// extract.ts (lowercased, alnum-only, underscore-separated tokens
// flattened to the bare alnum form).

export const VENDOR_GLYPHS: Record<string, VendorGlyphComponent> = {
  // Fast food / restaurants
  jollibee:      makeLetterGlyph("J",  "#E11D2A", "#E11D2A", "Jollibee"),
  mcdonalds:     makeLetterGlyph("M",  "#FFC72C", "oklch(0.40 0.15 80)", "McDonald's"),
  chowking:      makeLetterGlyph("C",  "#E84033", "#E84033", "Chowking"),
  manginasal:    makeLetterGlyph("Mi", "#9E1B1B", "#9E1B1B", "Mang Inasal"),
  goldilocks:    makeLetterGlyph("G",  "#FFB81C", "oklch(0.40 0.15 80)", "Goldilocks"),
  starbucks:     makeLetterGlyph("S",  "#00704A", "#00704A", "Starbucks"),
  dunkin:        makeLetterGlyph("D",  "#FF6E1B", "#FF6E1B", "Dunkin"),
  // Convenience / groceries
  seveneleven:   makeLetterGlyph("7",  "#008C44", "#008C44", "7-Eleven"),
  ministop:      makeLetterGlyph("Mi", "#003DA5", "#003DA5", "MiniStop"),
  familymart:    makeLetterGlyph("F",  "#1B4F9E", "#1B4F9E", "FamilyMart"),
  savemore:      makeLetterGlyph("Sv", "#E11D2A", "#E11D2A", "Savemore"),
  robinsons:     makeLetterGlyph("R",  "#E11D2A", "#E11D2A", "Robinsons"),
  puregold:      makeLetterGlyph("Pg", "#E11D2A", "#E11D2A", "Puregold"),
  sm:            makeLetterGlyph("SM", "#003DA5", "#003DA5", "SM"),
  // Drug / health
  mercurydrug:   makeLetterGlyph("Md", "#E11D2A", "#E11D2A", "Mercury Drug"),
  generika:      makeLetterGlyph("Gn", "#00A88F", "#00A88F", "Generika"),
  watsons:       makeLetterGlyph("W",  "#00A88F", "#00A88F", "Watsons"),
  // Logistics / transit
  shopee:        ShopeeGlyph,
  lazada:        makeLetterGlyph("L",  "#0F146C", "#0F146C", "Lazada"),
  grab:          GrabGlyph,
  jeepney:       JeepneyGlyph,
  lbc:           LbcGlyph,
  jrs:           makeLetterGlyph("JR", "#003DA5", "#003DA5", "JRS Express"),
  cebupacific:   makeLetterGlyph("Cp", "#FCB813", "oklch(0.40 0.15 80)", "Cebu Pacific"),
  philippineairlines: makeLetterGlyph("PA", "#1B4F9E", "#1B4F9E", "Philippine Airlines"),
  // Misc PH chain coverage
  bdo:           makeLetterGlyph("BD", "#003DA5", "#003DA5", "BDO"),
  bpi:           makeLetterGlyph("BP", "#E11D2A", "#E11D2A", "BPI"),
  metrobank:     makeLetterGlyph("M",  "#005EB8", "#005EB8", "Metrobank"),
  meralco:       makeLetterGlyph("Me", "#1F77B4", "#1F77B4", "Meralco"),
  globe:         makeLetterGlyph("Gl", "#0033A0", "#0033A0", "Globe Telecom"),
  smart:         makeLetterGlyph("Sm", "#00833E", "#00833E", "Smart Comms"),
};
