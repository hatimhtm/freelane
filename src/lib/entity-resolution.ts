import type { Entity, Spend, SpendEntityLink } from "@/lib/supabase/types";

// Entity resolution. Mirrors the vendor side but resolves against the smaller
// entities pool (people, pets, household, places, concepts). Used by:
//   - spend create/update: auto-link by alias match
//   - the New Entity Curiosity brain: detect when a description references an
//     unknown entity (cat treats with no "Our cats" entity yet)
//   - Wife Preferences Corpus: read every Wife-tagged spend through the entity

const NORM_RE = /[^a-z0-9]+/g;

export function normalizeEntityText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}+/gu, "")
    .replace(NORM_RE, " ")
    .trim();
}

export interface EntityMatch {
  entity: Entity;
  matchedAlias: string;
}

// Find every entity whose canonical name or alias appears as a word-boundary
// match in the description. Returns ALL matches — a spend can reference
// multiple entities ("for Lola and the cats"). Caller dedupes by id.
export function matchEntitiesInDescription(
  description: string,
  entities: Entity[],
): EntityMatch[] {
  const desc = description ?? "";
  if (!desc.trim()) return [];
  const norm = normalizeEntityText(desc);

  const out: EntityMatch[] = [];
  for (const e of entities) {
    if (e.archived) continue;
    const candidates = [e.canonical_name, ...(e.aliases ?? [])];
    let matched: string | null = null;
    for (const cand of candidates) {
      const cnorm = normalizeEntityText(cand);
      if (!cnorm) continue;
      if (matchAsWord(norm, cnorm)) {
        matched = cand;
        break;
      }
    }
    if (matched) out.push({ entity: e, matchedAlias: matched });
  }
  return out;
}

function matchAsWord(haystack: string, needle: string): string | null {
  if (!needle) return null;
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    const before = idx === 0 ? "" : haystack[idx - 1];
    const after = haystack[idx + needle.length] ?? "";
    const boundaryBefore = !/[a-z0-9]/.test(before);
    const boundaryAfter = !/[a-z0-9]/.test(after);
    if (boundaryBefore && boundaryAfter) return needle;
    from = idx + 1;
  }
  return null;
}

// Find unmatched "suggestive" tokens — descriptions that mention an
// unrecognised noun the AI should ask about. Heuristic only; the actual
// New Entity Curiosity decision happens in src/lib/ai/new-entity-curiosity.ts.
// Returns lowercase candidate phrases of 4-30 chars.
export function unmatchedTokens(description: string, knownTexts: string[]): string[] {
  const norm = normalizeEntityText(description);
  if (!norm) return [];
  const knownNormed = new Set(knownTexts.map(normalizeEntityText).filter(Boolean));
  // Split into 1-3 word windows and filter to multi-letter phrases that don't
  // overlap with any known entity. Caller filters to noun-shape with stopwords.
  const words = norm.split(/\s+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= 3 && i + n <= words.length; n++) {
      const phrase = words.slice(i, i + n).join(" ");
      if (phrase.length < 4 || phrase.length > 30) continue;
      // Skip if any known entity phrase contains this candidate.
      let collides = false;
      for (const known of knownNormed) {
        if (known.includes(phrase) || phrase.includes(known)) { collides = true; break; }
      }
      if (!collides) out.add(phrase);
    }
  }
  return Array.from(out);
}

export function entitiesForSpend(
  spendId: string,
  links: SpendEntityLink[],
  entities: Entity[],
): Entity[] {
  const ids = new Set(links.filter((l) => l.spend_id === spendId).map((l) => l.entity_id));
  return entities.filter((e) => ids.has(e.id));
}

// "It's For Us" surface — total household spend in a window.
export function householdTotalBase(spends: Spend[], start: Date, end?: Date): number {
  return spends
    .filter((s) => {
      if (!s.for_us) return false;
      const d = new Date(s.spent_at);
      return d >= start && (!end || d <= end);
    })
    .reduce((sum, s) => sum + Number(s.amount_base ?? 0), 0);
}
