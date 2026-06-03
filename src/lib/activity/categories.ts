// Activity feed taxonomy. Shared between the virtual feed library and the
// /activity view. Every union row lands in exactly one of these buckets so
// the primary chip row can multi-select cleanly.

import type { LucideIcon } from "lucide-react";
import {
  Wallet,
  Calendar,
  MessageSquare,
  HeartPulse,
  Brain,
  Bell,
} from "lucide-react";

export type ActivityCategory =
  | "money"
  | "intent"
  | "chat"
  | "body"
  | "ai"
  | "system";

export type ActivityCategoryMeta = {
  key: ActivityCategory;
  label: string;
  icon: LucideIcon;
};

export const CATEGORIES: ActivityCategoryMeta[] = [
  { key: "money",  label: "Money",  icon: Wallet },
  { key: "intent", label: "Intent", icon: Calendar },
  { key: "chat",   label: "Chat",   icon: MessageSquare },
  { key: "body",   label: "Body",   icon: HeartPulse },
  { key: "ai",     label: "AI",     icon: Brain },
  { key: "system", label: "System", icon: Bell },
];

// Pre-bake the lookup so view-side iteration is O(1).
export const CATEGORY_BY_KEY: Record<ActivityCategory, ActivityCategoryMeta> =
  Object.fromEntries(CATEGORIES.map((c) => [c.key, c])) as Record<
    ActivityCategory,
    ActivityCategoryMeta
  >;

// Maps a source_table (+ optional row kind hint) to its category bucket.
// New sources should land in `sources-registry.ts` first; this switch
// stays table-aware for the few sources that split on `kind` (currently
// just sadaka_ledger). When the registry grows but this switch doesn't,
// the default "system" bucket is the safe fallback — the row still
// surfaces in the feed under the System chip.
export function categoryForSource(
  source_table: string,
  kind?: string | null,
): ActivityCategory {
  switch (source_table) {
    case "spends":
    case "withdrawals":
    case "loans":
    case "loan_returns":
    case "loan_forgivals":
      return "money";
    case "sadaka_ledger":
      // Decay / adjustment are bookkeeping; contributions + payments hit money.
      if (kind === "decay" || kind === "adjustment") return "system";
      return "money";
    case "planned_spends":
      return "intent";
    case "chat_messages":
      return "chat";
    case "letters":
    case "ai_user_facts":
    case "vendors":
      return "ai";
    case "entities":
      return "intent";
    case "morning_log":
    case "wellbeing_checkins":
    case "diary_entries":
      return "body";
    case "notifications_inbox":
      return "system";
    default:
      return "system";
  }
}
