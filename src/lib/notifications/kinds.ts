// Canonical catalog of registered notification kinds. The per-kind prefs
// table (Settings → Notifications) iterates this list to render its rows,
// and the click-routing registry asserts the kind key against this set.
//
// Adding a new kind: append a row here, append a handler to
// src/lib/notifications/click-routing.tsx, and any future workflow that
// dispatches the kind will be wired by default.

import {
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
};

export function iconForKind(kind: string): LucideIcon {
  return KIND_ICONS[kind] ?? Bell;
}
