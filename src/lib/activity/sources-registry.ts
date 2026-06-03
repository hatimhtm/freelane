// Single source of truth for the set of activity source tables.
//
// The feed has THREE consumers that all need to agree on this set:
//   1. feed.ts — the per-source query specs (table, timestamp column,
//      select projection, mapper). feed.ts now LOOKS UP `categories`
//      via SOURCE_BY_TABLE so the registry is the only place that
//      declares them. A missing registry entry becomes a runtime
//      throw in buildSpecs(), and `noun` is exposed for screen-reader
//      labels in activity-row.tsx.
//   2. categories.ts — the source-table → category bucket function
//      (still drives the per-row category for split-bucket sources).
//   3. activity-view.tsx — the dropdown the user picks from.
//   4. activity-row.tsx — the per-source noun used in aria-labels.
//
// When the schema grows, add ONE entry here and the rest follows. The
// SourceSpec in feed.ts still has to register the timestamp column +
// projection + mapper (none of that lives here) — but the table key,
// display label, categories, and noun are pulled from this list.

import type { ActivityCategory } from "./categories";

export type SourceTable =
  | "spends"
  | "withdrawals"
  | "sadaka_ledger"
  | "planned_spends"
  | "notifications_inbox"
  | "chat_messages"
  | "letters"
  | "loans"
  | "loan_returns"
  | "loan_forgivals"
  | "ai_user_facts"
  | "vendors"
  | "entities"
  | "morning_log"
  | "wellbeing_checkins"
  | "diary_entries";

export type ActivitySourceMeta = {
  table: SourceTable;
  label: string;
  // Per-source noun used by the row aria-label (e.g. "open spend
  // detail"). Lowercase, no article. Kept here so a new source can
  // never accidentally read as "open notifications_inbox detail" to
  // a screen reader.
  noun: string;
  // Pre-cached category bucket(s). Sources that span buckets
  // (sadaka_ledger maps to money OR system depending on row.kind)
  // list both. Used by feed.ts for query-time skipping when the
  // caller's category filter excludes the source entirely.
  categories: ActivityCategory[];
};

export const SOURCE_REGISTRY: ActivitySourceMeta[] = [
  { table: "spends",              label: "Spends",         noun: "spend",              categories: ["money"] },
  { table: "withdrawals",         label: "Withdrawals",    noun: "withdrawal",         categories: ["money"] },
  { table: "sadaka_ledger",       label: "Sadaka",         noun: "Sadaka event",       categories: ["money", "system"] },
  { table: "planned_spends",      label: "Plans",          noun: "plan",               categories: ["intent"] },
  { table: "notifications_inbox", label: "Notifications",  noun: "notification",       categories: ["system"] },
  { table: "chat_messages",       label: "Chat",           noun: "chat message",       categories: ["chat"] },
  { table: "letters",             label: "Letters",        noun: "letter",             categories: ["ai"] },
  { table: "loans",               label: "Loans",          noun: "loan",               categories: ["money"] },
  { table: "loan_returns",        label: "Loan returns",   noun: "loan return",        categories: ["money"] },
  { table: "loan_forgivals",      label: "Loan forgivals", noun: "loan forgival",      categories: ["money"] },
  { table: "ai_user_facts",       label: "AI facts",       noun: "AI memory",          categories: ["ai"] },
  { table: "vendors",             label: "Vendors",        noun: "vendor",             categories: ["ai"] },
  { table: "entities",            label: "People",         noun: "person",             categories: ["intent"] },
  { table: "morning_log",         label: "Morning log",    noun: "morning log",        categories: ["body"] },
  { table: "wellbeing_checkins",  label: "Wellbeing",      noun: "wellbeing check-in", categories: ["body"] },
  { table: "diary_entries",       label: "Diary",          noun: "diary entry",        categories: ["body"] },
];

export const SOURCE_BY_TABLE: Map<string, ActivitySourceMeta> = new Map(
  SOURCE_REGISTRY.map((s) => [s.table, s]),
);

// Throwing accessor used by feed.ts so a future source spec added
// without a registry entry fails LOUDLY at startup rather than
// silently emitting rows with no label or noun.
export function requireSourceMeta(table: string): ActivitySourceMeta {
  const meta = SOURCE_BY_TABLE.get(table);
  if (!meta) {
    throw new Error(
      `[activity] Source table "${table}" is not registered in SOURCE_REGISTRY. ` +
        `Add it to src/lib/activity/sources-registry.ts before wiring a feed spec.`,
    );
  }
  return meta;
}
