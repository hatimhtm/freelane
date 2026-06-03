// Canonical catalog of registered notification kinds. The per-kind prefs
// table (Settings → Notifications) iterates this list to render its rows,
// and the click-routing registry asserts the kind key against this set.
//
// Adding a new kind: append a row here, append a handler to
// src/lib/notifications/click-routing.tsx, and any future workflow that
// dispatches the kind will be wired by default.

import {
  AlertCircle,
  AlertTriangle,
  Bell,
  CalendarClock,
  ClipboardList,
  HandHeart,
  HelpCircle,
  Info,
  MessageCircle,
  RefreshCw,
  Sparkles,
  Star,
  Store,
  TrendingUp,
  UserCog,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type KindMeta = {
  key: string;
  label: string;
  description: string;
};

export const KNOWN_KINDS: KindMeta[] = [
  {
    key: "tuesday_checkin",
    label: "Tuesday check-in",
    description: "A line and two numbers each Tuesday morning.",
  },
  {
    key: "info",
    label: "Info",
    description: "Quiet informational messages — read and dismiss.",
  },
  {
    key: "app_update_available",
    label: "App update available",
    description: "A new build of Freelane is ready.",
  },
  {
    key: "ai_question",
    label: "AI questions",
    description: "The brain asks for clarification on a spend, plan, or client.",
  },
  {
    key: "plan_due",
    label: "Plan due",
    description: "Quiet reminder a plan's due date is near.",
  },
  {
    key: "wallet_anchor_stale",
    label: "Wallet anchor stale",
    description: "A holding wallet hasn't been re-anchored in a long while.",
  },
  {
    key: "recovery_complete",
    label: "Recovery complete",
    description: "Heads-up when a recovery period closes out.",
  },
  {
    key: "ai_clarifying_question",
    label: "AI clarifying question",
    description: "The brain needs a quick answer to keep tuning to you.",
  },
  {
    key: "storm_active",
    label: "Storm active",
    description: "A tight stretch just opened. The dashboard pills carry the detail.",
  },
  {
    key: "sadaka_nudge",
    label: "Sadaka nudge",
    description: "Quiet voluntary-charity moment when the pool is sizeable and liquidity is fine.",
  },
  {
    key: "client_pattern_change",
    label: "Client pattern changed",
    description: "A client's payment method or project size shifted significantly.",
  },
  {
    key: "vendor_identify_request",
    label: "Tell me about a vendor",
    description: "The brain spotted an unknown vendor and wants a quick description to find a brand glyph.",
  },
  // Plans redesign (migrations 0088-0089) — three new kinds.
  {
    key: "plan_satisfaction_check",
    label: "Plan satisfaction check",
    description: "Two weeks after a purchase — a 1-5 rating plus an optional note.",
  },
  {
    key: "plan_strategy_stale",
    label: "Plan strategy off-track",
    description: "An active savings strategy hasn't been holding up. Alternatives are ready.",
  },
  {
    key: "plan_target_approaching",
    label: "Plan target approaching",
    description: "Thirty days before a plan's target date — a quiet heads-up.",
  },
  // Vendors workflow — two new kinds.
  {
    key: "vendor_clarify",
    label: "What is this vendor?",
    description:
      "The brain proposes a canonical name for a vendor you just typed; pick a chip or correct it.",
  },
  {
    key: "vendor_price_check_weekly",
    label: "Weekly vendor price changes",
    description:
      "Sunday morning bundle of vendor + item price shifts noticed over the trailing weeks.",
  },
  // Entities workflow (freelane-entities-design 2026-06-03) — four new
  // kinds covering Gate 1, Gate 2, introductions, and pattern detection.
  {
    key: "entity_discovery_request",
    label: "Add a new person?",
    description:
      "The brain spotted a name in a spend note, chat, or sadaka tag and asks before adding it as someone you know.",
  },
  {
    key: "entity_clarify",
    label: "Who is this person?",
    description:
      "After an entity is created, the brain proposes a name + relationship; pick a chip or correct it.",
  },
  {
    key: "entity_introduction",
    label: "Tell me about this person",
    description:
      "First monetary event or first note with someone — a single quiet question to capture context.",
  },
  {
    key: "entity_pattern_change",
    label: "Person pattern changed",
    description:
      "Someone's cadence, amount, interaction kind, or money-flow direction shifted significantly.",
  },
];

export const KNOWN_KIND_KEYS = new Set(KNOWN_KINDS.map((k) => k.key));

// Visual marker per kind so a person can scan the inbox / bell popover
// without reading every subject. Both the popover row and the
// /notifications row use this — unknown kinds fall back to a neutral Bell.
const KIND_ICONS: Record<string, LucideIcon> = {
  tuesday_checkin: MessageCircle,
  info: Info,
  app_update_available: RefreshCw,
  ai_question: Sparkles,
  plan_due: CalendarClock,
  wallet_anchor_stale: Wallet,
  recovery_complete: ClipboardList,
  ai_clarifying_question: HelpCircle,
  storm_active: AlertTriangle,
  sadaka_nudge: HandHeart,
  client_pattern_change: UserCog,
  vendor_identify_request: Store,
  plan_satisfaction_check: Star,
  plan_strategy_stale: AlertCircle,
  plan_target_approaching: CalendarClock,
  vendor_clarify: HelpCircle,
  vendor_price_check_weekly: TrendingUp,
  entity_discovery_request: UserCog,
  entity_clarify: HelpCircle,
  entity_introduction: MessageCircle,
  entity_pattern_change: UserCog,
};

export function iconForKind(kind: string): LucideIcon {
  return KIND_ICONS[kind] ?? Bell;
}
