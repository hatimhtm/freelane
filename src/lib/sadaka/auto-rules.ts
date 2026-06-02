import "server-only";

// Freelane Sadaka — auto-rules type surface.
//
// Why this sibling exists: Next.js 16's "use server" rule rejects
// non-async RUNTIME exports (constants, objects, plain functions) from
// a "use server" module. TypeScript types are erased at compile time
// and don't trip the rule — but mixing types into a "use server" file
// makes the import-side contract muddier and forces the action module
// to do double duty.
//
// The convention here: every shared TYPE + CONSTANT lives in a sibling
// pure module guarded by `import "server-only"`; the matching
// `*-actions.ts` file carries "use server" and exports ONLY async
// functions plus re-imports types from its sibling.
//
// The Chatbot + Sadaka workflows had to be patched when the old
// auto-rules.ts mixed "use server" with RUNTIME constants (not types)
// — the Next 16 build rejected those non-async values. Types alone
// would have been fine to colocate, but the sibling split keeps the
// rule legible and uniform across the codebase.

export type AutoRuleMatchKind =
  | "vendor_pattern"
  | "category"
  | "note_pattern"
  | "denylist_note";

export type AutoRuleRow = {
  id: string;
  user_id: string;
  match_kind: AutoRuleMatchKind;
  pattern: string;
  active: boolean;
  label: string | null;
  created_at: string;
};

export type CreateAutoRuleInput = {
  match_kind: AutoRuleMatchKind;
  pattern: string;
  label?: string | null;
  active?: boolean;
};
