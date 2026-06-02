import "server-only";

// Freelane Sadaka — auto-rules type surface.
//
// Why this sibling exists: Next.js 16 enforces "use server" files export
// ONLY async functions. Types (and any constants) live HERE; the matching
// `auto-rules-actions.ts` keeps the client-callable server actions and
// imports the type exports from this file.
//
// The Chatbot + Sadaka workflows had to be patched for this exact rule
// (the old auto-rules.ts had both "use server" and type exports, which the
// Next 16 build rejected) — don't re-introduce the regression.

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
