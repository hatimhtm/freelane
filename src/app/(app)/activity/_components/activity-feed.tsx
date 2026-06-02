"use client";

import { useMemo } from "react";
import { motion } from "motion/react";
import {
  Activity,
  Archive,
  Check,
  FileText,
  KanbanSquare,
  Receipt,
  Settings as SettingsIcon,
  Sun,
  Trash2,
  Users,
  Wallet,
  Bookmark,
  Bell,
  Plus,
  Pencil,
  ArrowRight,
  ArrowDownToLine,
  ShoppingBag,
  Tag,
  Repeat,
  SkipForward,
  HandCoins,
  Brain,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityEvent, EventKind } from "@/lib/supabase/types";

type KindMeta = {
  icon: React.ComponentType<{ className?: string }>;
  tone: "brand" | "cyan" | "amber" | "rose" | "success" | "neutral";
};

const META: Record<EventKind, KindMeta> = {
  "client.created":  { icon: Plus,         tone: "brand"   },
  "client.updated":  { icon: Pencil,       tone: "neutral" },
  "client.archived": { icon: Archive,      tone: "neutral" },
  "client.deleted":  { icon: Trash2,       tone: "rose"    },

  "project.created":        { icon: KanbanSquare, tone: "brand"   },
  "project.updated":        { icon: Pencil,       tone: "neutral" },
  "project.status_changed": { icon: ArrowRight,   tone: "cyan"    },
  "project.deleted":        { icon: Trash2,       tone: "rose"    },

  "payment.added":   { icon: Wallet, tone: "success" },
  "payment.updated": { icon: Pencil, tone: "neutral" },
  "payment.removed": { icon: Trash2, tone: "rose"    },

  "invoice.created":  { icon: FileText, tone: "amber"   },
  "invoice.updated":  { icon: Pencil,   tone: "neutral" },
  "invoice.reminded": { icon: Bell,     tone: "amber"   },
  "invoice.deleted":  { icon: Trash2,   tone: "rose"    },

  "template.created": { icon: Bookmark, tone: "neutral" },
  "template.deleted": { icon: Trash2,   tone: "rose"    },

  "method.created":  { icon: Plus,    tone: "brand"   },
  "method.updated":  { icon: Pencil,  tone: "neutral" },
  "method.archived": { icon: Archive, tone: "neutral" },

  "project.flagged":   { icon: Bell,       tone: "amber"   },
  "project.unflagged": { icon: ArrowRight, tone: "neutral" },

  "client.memory_added": { icon: Pencil, tone: "neutral" },

  "withdrawal.added":   { icon: ArrowDownToLine, tone: "rose"    },
  "withdrawal.removed": { icon: Trash2,          tone: "neutral" },

  "spend.added":   { icon: ShoppingBag, tone: "neutral" },
  "spend.updated": { icon: ShoppingBag, tone: "neutral" },
  "spend.removed": { icon: ShoppingBag, tone: "rose"    },

  "spend_category.created": { icon: Tag, tone: "neutral" },
  "spend_category.updated": { icon: Tag, tone: "neutral" },
  "spend_category.deleted": { icon: Tag, tone: "rose"    },

  "recurring_spend.created": { icon: Repeat,       tone: "neutral" },
  "recurring_spend.updated": { icon: Repeat,       tone: "neutral" },
  "recurring_spend.deleted": { icon: Repeat,       tone: "rose"    },
  "recurring_spend.paid":    { icon: Repeat,       tone: "success" },
  "recurring_spend.skipped": { icon: SkipForward,  tone: "neutral" },

  "loan.created": { icon: HandCoins, tone: "neutral" },
  "loan.updated": { icon: HandCoins, tone: "neutral" },
  "loan.closed":  { icon: HandCoins, tone: "success" },
  "loan.deleted": { icon: HandCoins, tone: "rose"    },

  "loan_installment.added":   { icon: HandCoins,   tone: "neutral" },
  "loan_installment.paid":    { icon: HandCoins,   tone: "success" },
  "loan_installment.skipped": { icon: SkipForward, tone: "neutral" },
  "loan_installment.deleted": { icon: Trash2,      tone: "neutral" },

  "user_memory.note_added":  { icon: Brain, tone: "neutral" },
  "user_memory.observation": { icon: Brain, tone: "neutral" },

  "ai_question.queued":    { icon: Brain,  tone: "neutral" },
  "ai_question.answered":  { icon: Brain,  tone: "success" },
  "ai_question.dismissed": { icon: Brain,  tone: "neutral" },

  "wallet.opening_balance_set": { icon: Wallet, tone: "neutral" },

  "planned_spend.created":   { icon: Plus,         tone: "brand"   },
  "planned_spend.updated":   { icon: Plus,         tone: "neutral" },
  "planned_spend.committed": { icon: Wallet,       tone: "success" },
  "planned_spend.done":      { icon: Check,        tone: "success" },
  "planned_spend.cancelled": { icon: Trash2,       tone: "rose"    },
  "planned_spend.deleted":   { icon: Trash2,       tone: "rose"    },

  "calm_weather.refreshed":  { icon: Brain,        tone: "neutral" },
  "app_changelog.published": { icon: Brain,        tone: "brand"   },

  "vendor.created":   { icon: Plus,    tone: "brand"   },
  "vendor.updated":   { icon: Pencil,  tone: "neutral" },
  "vendor.archived":  { icon: Archive, tone: "neutral" },
  "vendor.deleted":   { icon: Trash2,  tone: "rose"    },
  "vendor.linked":    { icon: Tag,     tone: "neutral" },
  "vendor.unlinked":  { icon: Tag,     tone: "neutral" },

  "entity.created":   { icon: Plus,    tone: "brand"   },
  "entity.updated":   { icon: Pencil,  tone: "neutral" },
  "entity.archived":  { icon: Archive, tone: "neutral" },
  "entity.deleted":   { icon: Trash2,  tone: "rose"    },
  "entity.linked":    { icon: Tag,     tone: "neutral" },
  "entity.unlinked":  { icon: Tag,     tone: "neutral" },

  "wife_state.updated":         { icon: Brain, tone: "neutral" },
  "wife_preferences.consolidated": { icon: Brain, tone: "success" },

  "letter.generated": { icon: FileText, tone: "brand"   },
  "letter.pinned":    { icon: Bookmark, tone: "amber"   },
  "letter.replied":   { icon: Pencil,   tone: "success" },
  "letter.deleted":   { icon: Trash2,   tone: "rose"    },

  "milestone.recorded": { icon: Check,  tone: "success" },
  "milestone.replied":  { icon: Pencil, tone: "neutral" },
  "milestone.deleted":  { icon: Trash2, tone: "rose"    },

  "quiet_receipt.recorded": { icon: Receipt, tone: "neutral" },
  "quiet_receipt.replied":  { icon: Pencil,  tone: "neutral" },
  "quiet_receipt.deleted":  { icon: Trash2,  tone: "rose"    },

  "life_shift.recorded": { icon: Activity, tone: "neutral" },
  "life_shift.replied":  { icon: Pencil,   tone: "neutral" },
  "life_shift.deleted":  { icon: Trash2,   tone: "rose"    },

  "morning_log.saved":      { icon: Sun,   tone: "brand"   },
  // TODO(post-0053-drop): no live writer emits these kinds; remove with the
  // finance.intent_mirror table when migration 0056 lands.
  "intent_mirror.saved":    { icon: Brain, tone: "neutral" },
  "intent_mirror.refreshed":{ icon: Brain, tone: "success" },

  "wellbeing.checkin_saved":  { icon: Brain,  tone: "neutral" },
  "wellbeing.echo_generated": { icon: Brain,  tone: "success" },
  "quiet_channel.detected":   { icon: Bell,   tone: "amber"   },
  "quiet_channel.resolved":   { icon: Check,  tone: "success" },
  "rate_insight.generated":   { icon: Brain,  tone: "brand"   },
  "rate_insight.replied":     { icon: Pencil, tone: "neutral" },
  "rate_insight.acted":       { icon: Check,  tone: "success" },
  "should_i_buy.asked":       { icon: Brain,  tone: "neutral" },
  "should_i_buy.decided":     { icon: Check,  tone: "success" },

  "settings.updated": { icon: SettingsIcon, tone: "neutral" },
};

const FALLBACK_META: KindMeta = { icon: ArrowRight, tone: "neutral" };

const TONE_STYLES: Record<KindMeta["tone"], { ring: string; text: string; bg: string }> = {
  brand:   { ring: "ring-[var(--chart-1)]/25", text: "text-[var(--chart-1)]", bg: "bg-[var(--chart-1)]/12" },
  cyan:    { ring: "ring-[var(--chart-2)]/25", text: "text-[var(--chart-2)]", bg: "bg-[var(--chart-2)]/12" },
  amber:   { ring: "ring-[var(--chart-3)]/25", text: "text-[var(--chart-3)]", bg: "bg-[var(--chart-3)]/12" },
  rose:    { ring: "ring-[var(--chart-4)]/25", text: "text-[var(--chart-4)]", bg: "bg-[var(--chart-4)]/12" },
  success: { ring: "ring-[var(--chart-5)]/25", text: "text-[var(--chart-5)]", bg: "bg-[var(--chart-5)]/12" },
  neutral: { ring: "ring-border",              text: "text-muted-foreground", bg: "bg-muted" },
};

export function ActivityFeed({
  events,
  clientsById,
}: {
  events: ActivityEvent[];
  clientsById: Map<string, string>;
}) {
  const grouped = useMemo(
    () => groupByDay(events.filter((e) => e.kind !== "user_memory.observation")),
    [events],
  );

  return (
    <div className="space-y-8">
      {grouped.map((group, gIdx) => (
        <motion.section
          key={group.key}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: gIdx * 0.02 }}
        >
          <div className="mb-3 flex items-center gap-3">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {group.label}
            </div>
            <div className="h-px flex-1 bg-border/60" />
            <div className="text-xs text-muted-foreground/70">
              {group.events.length} event{group.events.length === 1 ? "" : "s"}
            </div>
          </div>

          <ol className="relative ml-3 space-y-0 border-l border-border/60">
            {group.events.map((event, i) => {
              const meta = META[event.kind as EventKind] ?? FALLBACK_META;
              const Icon = meta.icon;
              const tone = TONE_STYLES[meta.tone];
              const clientName = event.client_id ? clientsById.get(event.client_id) : null;
              return (
                <motion.li
                  key={event.id}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: i * 0.02 }}
                  className="relative pl-6 pb-5 last:pb-0"
                >
                  <span
                    className={cn(
                      "absolute -left-[10px] top-0.5 grid h-5 w-5 place-items-center rounded-full ring-2",
                      tone.ring,
                      tone.bg,
                    )}
                  >
                    <Icon className={cn("h-3 w-3", tone.text)} />
                  </span>
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{event.title}</div>
                      {clientName && (
                        <div className="truncate text-xs text-muted-foreground">
                          <Users className="mr-1 inline h-3 w-3" />
                          {clientName}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-xs text-muted-foreground/70 tabular">
                      {formatTime(event.created_at)}
                    </div>
                  </div>
                </motion.li>
              );
            })}
          </ol>
        </motion.section>
      ))}
    </div>
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function groupByDay(events: ActivityEvent[]) {
  const now = new Date();
  const today = keyOfDay(now);
  const yesterday = keyOfDay(new Date(now.getTime() - 86400000));
  const buckets: { key: string; label: string; events: ActivityEvent[] }[] = [];
  const index = new Map<string, number>();
  for (const event of events) {
    const d = new Date(event.created_at);
    const key = keyOfDay(d);
    let i = index.get(key);
    if (i === undefined) {
      i = buckets.length;
      index.set(key, i);
      buckets.push({
        key,
        label:
          key === today
            ? "Today"
            : key === yesterday
              ? "Yesterday"
              : d.toLocaleDateString(undefined, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
                }),
        events: [],
      });
    }
    buckets[i].events.push(event);
  }
  return buckets;
}

function keyOfDay(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
