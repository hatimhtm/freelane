import { cn } from "@/lib/utils";

// Brand-tinted glyphs for the common payment rails Hatim actually uses
// (GCash, coin.ph, Wise, PayPal, BPI, plus generic Bank / Cash). Anything
// unknown falls through to a brand-tinted initials tile so every wallet card
// still carries an identity instead of the lucide Wallet stand-in.
//
// Tints stay close to each rail's known brand colour but live in oklch so
// they sit on Freelane's paper/ink surfaces without screaming. SVG is laid
// out in a 32x32 viewBox — sized via className from the call site.

type Tint = { bg: string; fg: string };

interface MethodSpec {
  // Matches against a lowercased / stripped slug ("coinph", "gcash"...).
  slugs: readonly string[];
  // Display initials used for the tile fallback AND as the inner mark when
  // we don't have a hand-drawn vector glyph yet — keeps the visual idiom
  // consistent across the leaderboard, holdings grid, and pickers.
  initials: string;
  tint: Tint;
}

// Curated palette — chosen for legibility on dark card surfaces, not pixel
// brand fidelity. Logos are trademarks; we render initials, not marks.
const METHOD_SPECS: readonly MethodSpec[] = [
  {
    slugs: ["gcash"],
    initials: "G",
    tint: { bg: "oklch(0.52 0.18 240)", fg: "oklch(0.98 0 0)" }, // GCash blue
  },
  {
    slugs: ["coinph", "coin"],
    initials: "C",
    tint: { bg: "oklch(0.6 0.18 145)", fg: "oklch(0.14 0 0)" }, // coin.ph green
  },
  {
    slugs: ["wise", "transferwise"],
    initials: "W",
    tint: { bg: "oklch(0.78 0.18 110)", fg: "oklch(0.18 0.05 145)" }, // Wise acid green
  },
  {
    slugs: ["paypal"],
    initials: "P",
    tint: { bg: "oklch(0.48 0.14 245)", fg: "oklch(0.98 0 0)" }, // PayPal navy
  },
  {
    slugs: ["bpi"],
    initials: "B",
    tint: { bg: "oklch(0.58 0.16 25)", fg: "oklch(0.98 0 0)" }, // BPI red
  },
  {
    slugs: ["bdo"],
    initials: "B",
    tint: { bg: "oklch(0.5 0.18 30)", fg: "oklch(0.98 0 0)" },
  },
  {
    slugs: ["unionbank", "ub"],
    initials: "U",
    tint: { bg: "oklch(0.5 0.16 280)", fg: "oklch(0.98 0 0)" },
  },
  {
    slugs: ["maya", "paymaya"],
    initials: "M",
    tint: { bg: "oklch(0.62 0.18 155)", fg: "oklch(0.14 0 0)" },
  },
  {
    slugs: ["payoneer"],
    initials: "P",
    tint: { bg: "oklch(0.6 0.18 25)", fg: "oklch(0.98 0 0)" },
  },
  {
    slugs: ["revolut"],
    initials: "R",
    tint: { bg: "oklch(0.3 0.04 260)", fg: "oklch(0.98 0 0)" },
  },
  {
    slugs: ["stripe"],
    initials: "S",
    tint: { bg: "oklch(0.55 0.18 280)", fg: "oklch(0.98 0 0)" },
  },
  {
    slugs: ["cash"],
    initials: "₱",
    tint: { bg: "oklch(0.7 0.15 90)", fg: "oklch(0.18 0 0)" }, // warm paper
  },
  {
    slugs: ["bank", "bankwire", "wire"],
    initials: "B",
    tint: { bg: "oklch(0.35 0.04 250)", fg: "oklch(0.98 0 0)" },
  },
];

// Brand-tinted neutral — used when nothing matches. Stays close to the ink
// surface so unknown rails don't shout.
const FALLBACK_TINT: Tint = {
  bg: "oklch(0.28 0.02 250)",
  fg: "oklch(0.95 0 0)",
};

function slugifyMethodName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");
}

function deriveInitials(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9 ]/g, " ").trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function resolveSpec(name: string): { initials: string; tint: Tint } {
  const slug = slugifyMethodName(name);
  for (const spec of METHOD_SPECS) {
    if (spec.slugs.some((s) => slug.includes(s))) {
      return { initials: spec.initials, tint: spec.tint };
    }
  }
  return { initials: deriveInitials(name), tint: FALLBACK_TINT };
}

export function MethodGlyph({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const { initials, tint } = resolveSpec(name);
  // SVG keeps the glyph crisp at any size + lets us tint via inline style
  // (Tailwind can't reach arbitrary oklch tokens without bloating the
  // utility tree). Rounded 32x32 mirrors the LogoMark cadence.
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("shrink-0", className)}
      aria-label={`${name} glyph`}
      role="img"
    >
      <rect width="32" height="32" rx="8" style={{ fill: tint.bg }} />
      <text
        x="16"
        y="17"
        textAnchor="middle"
        dominantBaseline="central"
        style={{ fill: tint.fg }}
        // font-family inherits the body stack — initials read as a clean
        // mark rather than a serif display character.
        className="font-sans"
        fontSize={initials.length > 1 ? 12 : 15}
        fontWeight={600}
        letterSpacing={initials.length > 1 ? "-0.02em" : "0"}
      >
        {initials}
      </text>
    </svg>
  );
}
