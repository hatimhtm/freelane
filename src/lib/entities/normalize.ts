import "server-only";

// Shared entity-name normalizer.
//
// The denylist + canonicalize + propose-from-signal pipelines all need
// the same lowercase + alpha-only form so spelling variations collapse
// onto a single key ("Junjun", "junjun", "Jun-jun" → "junjun"). Migration
// 0098 documents the canonical form as
//   lower(regexp_replace(name, '[^a-z0-9]+', '', 'g'))
// — this helper is the single JS-side mirror. Importing from one place
// keeps a future regex tweak from poisoning the denylist via skew.
//
// The verifier flagged three independent copies (discovery.ts:50-52,
// discovery-actions.ts:29-31, propose-entity-from-signal.ts:145-148) —
// they now all funnel through this helper.

export function normalizeEntityName(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw).toLowerCase().replace(/[^a-z0-9]+/g, "");
}
