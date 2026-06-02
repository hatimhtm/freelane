import { VENDOR_GLYPHS, type VendorGlyphComponent } from "@/components/brand/vendor-glyphs";

// PURE module. Curated PH vendor registry — tier 1 of the resolver chain
// defined in src/lib/brand/vendor-icon.ts.
//
// Each entry: { slug, label, color, glyph }. Slug is the normalized
// matching key (same form vendorSlug() produces). Label is the canonical
// display name. Color is the tile tint (hex or oklch). Glyph is the
// stylized SVG component — abstract / letterform, NEVER a literal
// corporate logo.
//
// Lookup strategy at the resolver level is: normalized exact → fuzzy
// substring on slug → tier 2 (AI brain) → tier 3 (generic).

export type VendorBrand = {
  slug: string;
  label: string;
  color: string | null;
  Glyph: VendorGlyphComponent;
};

function entry(slug: string, label: string, color: string | null): VendorBrand {
  const Glyph = VENDOR_GLYPHS[slug];
  if (!Glyph) {
    throw new Error(`vendor registry: missing glyph for slug "${slug}"`);
  }
  return { slug, label, color, Glyph };
}

export const VENDOR_REGISTRY: Record<string, VendorBrand> = {
  // Fast food / restaurants
  jollibee:      entry("jollibee",      "Jollibee",            "#E11D2A"),
  mcdonalds:     entry("mcdonalds",     "McDonald's",          "#FFC72C"),
  chowking:      entry("chowking",      "Chowking",            "#E84033"),
  manginasal:    entry("manginasal",    "Mang Inasal",         "#9E1B1B"),
  goldilocks:    entry("goldilocks",    "Goldilocks",          "#FFB81C"),
  starbucks:     entry("starbucks",     "Starbucks",           "#00704A"),
  dunkin:        entry("dunkin",        "Dunkin'",             "#FF6E1B"),
  // Convenience / groceries
  seveneleven:   entry("seveneleven",   "7-Eleven",            "#008C44"),
  ministop:      entry("ministop",      "MiniStop",            "#003DA5"),
  familymart:    entry("familymart",    "FamilyMart",          "#1B4F9E"),
  savemore:      entry("savemore",      "Savemore",            "#E11D2A"),
  robinsons:     entry("robinsons",     "Robinsons",           "#E11D2A"),
  puregold:      entry("puregold",      "Puregold",            "#E11D2A"),
  sm:            entry("sm",            "SM",                  "#003DA5"),
  // Drug / health
  mercurydrug:   entry("mercurydrug",   "Mercury Drug",        "#E11D2A"),
  generika:      entry("generika",      "Generika Drugstore",  "#00A88F"),
  watsons:       entry("watsons",       "Watsons",             "#00A88F"),
  // Logistics / transit
  shopee:        entry("shopee",        "Shopee",              "#EE4D2D"),
  lazada:        entry("lazada",        "Lazada",              "#0F146C"),
  grab:          entry("grab",          "Grab",                "#00B14F"),
  jeepney:       entry("jeepney",       "Jeepney",             "oklch(0.55 0.18 25)"),
  lbc:           entry("lbc",           "LBC",                 "#E11D2A"),
  jrs:           entry("jrs",           "JRS Express",         "#003DA5"),
  cebupacific:   entry("cebupacific",   "Cebu Pacific",        "#FCB813"),
  philippineairlines: entry("philippineairlines", "Philippine Airlines", "#1B4F9E"),
  // Misc PH chain coverage
  bdo:           entry("bdo",           "BDO",                 "#003DA5"),
  bpi:           entry("bpi",           "BPI",                 "#E11D2A"),
  metrobank:     entry("metrobank",     "Metrobank",           "#005EB8"),
  meralco:       entry("meralco",       "Meralco",             "#1F77B4"),
  globe:         entry("globe",         "Globe Telecom",       "#0033A0"),
  smart:         entry("smart",         "Smart Comms",         "#00833E"),
};

// Fuzzy aliases (substring needles), ordered longest/most-specific first so
// "manginasal" doesn't get pre-empted by "ma". Conservative — only add an
// alias if it's an unambiguous match across the PH retail landscape.
const FUZZY_ALIASES: Array<{ slug: string; needles: readonly string[] }> = [
  // No "pal" needle: substring matching false-positives on "salonpas",
  // "palawan" (Palawan Pawnshop chain), "palabok", etc. Stick to
  // unambiguous prefixes only.
  { slug: "philippineairlines", needles: ["philippineairlines", "philippineair"] },
  { slug: "cebupacific",        needles: ["cebupacific", "cebupac"] },
  { slug: "mercurydrug",        needles: ["mercurydrug", "mercury"] },
  { slug: "manginasal",         needles: ["manginasal", "inasal"] },
  { slug: "familymart",         needles: ["familymart"] },
  { slug: "seveneleven",        needles: ["seveneleven", "sevenelevn", "7eleven"] },
  { slug: "ministop",           needles: ["ministop"] },
  { slug: "savemore",           needles: ["savemore"] },
  { slug: "robinsons",          needles: ["robinsons", "robinson"] },
  { slug: "puregold",           needles: ["puregold"] },
  { slug: "starbucks",          needles: ["starbucks"] },
  { slug: "goldilocks",         needles: ["goldilocks"] },
  { slug: "chowking",           needles: ["chowking"] },
  { slug: "jollibee",           needles: ["jollibee"] },
  { slug: "mcdonalds",          needles: ["mcdonalds", "mcdo"] },
  { slug: "metrobank",          needles: ["metrobank"] },
  { slug: "meralco",            needles: ["meralco"] },
  { slug: "watsons",            needles: ["watsons"] },
  { slug: "generika",           needles: ["generika"] },
  { slug: "shopee",             needles: ["shopee"] },
  { slug: "lazada",             needles: ["lazada"] },
  { slug: "globe",              needles: ["globe"] },
  { slug: "smart",              needles: ["smartcomms", "smarttel"] },
  { slug: "dunkin",             needles: ["dunkin", "dunkindonuts"] },
  { slug: "jeepney",            needles: ["jeepney", "jeep"] },
  { slug: "grab",               needles: ["grabfood", "grabtaxi", "grab"] },
  { slug: "lbc",                needles: ["lbcexpress", "lbc"] },
  { slug: "jrs",                needles: ["jrsexpress", "jrs"] },
  { slug: "bdo",                needles: ["bdo"] },
  { slug: "bpi",                needles: ["bpi"] },
  { slug: "sm",                 needles: ["smmall", "smsupermarket"] },
];

export function normalizeVendorName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");
}

export function lookupCuratedVendorBrand(rawName: string): VendorBrand | null {
  const slug = normalizeVendorName(rawName);
  if (!slug) return null;
  // Exact slug hit first.
  if (VENDOR_REGISTRY[slug]) return VENDOR_REGISTRY[slug];
  // Then alias substring match.
  for (const { slug: target, needles } of FUZZY_ALIASES) {
    if (needles.some((n) => slug.includes(n))) {
      return VENDOR_REGISTRY[target] ?? null;
    }
  }
  return null;
}
