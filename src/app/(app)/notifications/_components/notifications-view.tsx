"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Notification } from "@/lib/notifications/dispatcher";
import type { WellbeingCheckin } from "@/lib/supabase/types";
import {
  clearDismissedAction,
  dismissNotificationAction,
  markAllReadAction,
  markNotificationReadAction,
} from "@/lib/notifications/actions";
import { EmptyState } from "@/components/app/empty-state";
import { TuesdayCheckinModal } from "@/components/app/tuesday-checkin-modal";
import { cn, phtTimeHHMM } from "@/lib/utils";

type Props = {
  rows: Notification[];
  icon?: LucideIcon;
  openTuesday?: boolean;
  tuesdayPrompt?: string;
  tuesdayCheckin?: WellbeingCheckin | null;
};

function bucket(iso: string): "today" | "week" | "older" {
  const now = Date.now();
  const ts = new Date(iso).getTime();
  const ageDays = (now - ts) / 86_400_000;
  if (ageDays < 1) return "today";
  if (ageDays < 7) return "week";
  return "older";
}

// PHT-anchored HH:mm — matches the Tuesday check-in's PHT dedup key so the
// timestamp the user reads can't jump on timezone boundaries (created_at is
// stored UTC, the inbox renders in PHT everywhere else).
function shortTime(iso: string): string {
  return phtTimeHHMM(new Date(iso));
}

export function NotificationsView({
  rows,
  icon: Icon = Bell,
  openTuesday = false,
  tuesdayPrompt = "",
  tuesdayCheckin = null,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState(rows);
  const [tuesdayOpen, setTuesdayOpen] = useState(openTuesday);

  const grouped = useMemo(() => {
    const today: Notification[] = [];
    const week: Notification[] = [];
    const older: Notification[] = [];
    for (const n of optimistic) {
      const b = bucket(n.created_at);
      if (b === "today") today.push(n);
      else if (b === "week") week.push(n);
      else older.push(n);
    }
    return { today, week, older };
  }, [optimistic]);

  const openNotification = (n: Notification) => {
    setOptimistic((cur) =>
      cur.map((row) => (row.id === n.id ? { ...row, read_at: row.read_at ?? new Date().toISOString() } : row)),
    );
    startTransition(async () => {
      await markNotificationReadAction(n.id);
      if (n.link_url) router.push(n.link_url);
    });
  };

  const dismiss = (id: string) => {
    setOptimistic((cur) => cur.filter((row) => row.id !== id));
    startTransition(async () => {
      await dismissNotificationAction(id);
    });
  };

  const markRead = (id: string) => {
    setOptimistic((cur) =>
      cur.map((row) => (row.id === id ? { ...row, read_at: row.read_at ?? new Date().toISOString() } : row)),
    );
    startTransition(async () => {
      await markNotificationReadAction(id);
    });
  };

  const markAll = () => {
    setOptimistic((cur) => cur.map((row) => ({ ...row, read_at: row.read_at ?? new Date().toISOString() })));
    startTransition(async () => {
      await markAllReadAction();
    });
  };

  const clearDismissed = () => {
    startTransition(async () => {
      await clearDismissedAction();
      router.refresh();
    });
  };

  const renderGroup = (title: string, list: Notification[]) => {
    if (list.length === 0) return null;
    return (
      <section className="space-y-3">
        <h2 className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{title}</h2>
        <ul className="overflow-hidden rounded-xl border border-border/60 bg-card">
          {list.map((n, idx) => (
            <li
              key={n.id}
              className={cn(
                "group flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-foreground/[0.025]",
                idx > 0 && "border-t border-border/40",
                n.priority >= 2 && "ring-1 ring-rose-500/15",
              )}
            >
              <button
                type="button"
                onClick={() => openNotification(n)}
                className="flex-1 cursor-pointer text-left"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={cn(
                      "text-[14px] leading-snug",
                      n.read_at ? "text-foreground/75" : "text-foreground font-medium",
                    )}
                  >
                    {n.subject}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                    {shortTime(n.created_at)}
                  </span>
                </div>
                {n.body && (
                  <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
                    {n.body}
                  </p>
                )}
                <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
                  {n.kind.replace(/_/g, " ")}
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                {!n.read_at && (
                  <button
                    type="button"
                    aria-label="Mark read"
                    onClick={() => markRead(n.id)}
                    disabled={pending}
                    className="grid h-7 w-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => dismiss(n.id)}
                  disabled={pending}
                  className="grid h-7 w-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-rose-500"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    );
  };

  const total = optimistic.length;
  const unread = optimistic.filter((n) => !n.read_at).length;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 md:px-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Inbox</div>
          <h1 className="display-headline mt-1 text-3xl md:text-4xl">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total === 0
              ? "Nothing in the inbox yet."
              : `${unread} unread of ${total}.`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[12px]">
          {unread > 0 && (
            <button
              type="button"
              onClick={markAll}
              disabled={pending}
              className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              Mark all read
            </button>
          )}
          <button
            type="button"
            onClick={clearDismissed}
            disabled={pending}
            className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            Clear dismissed
          </button>
        </div>
      </header>

      {total === 0 ? (
        <EmptyState
          icon={Icon}
          title="A quiet inbox"
          description="When something needs you — a check-in, a stale anchor, a question about a spend — it'll show up here."
        />
      ) : (
        <div className="space-y-8">
          {renderGroup("Today", grouped.today)}
          {renderGroup("Earlier this week", grouped.week)}
          {renderGroup("Older", grouped.older)}
        </div>
      )}
      {tuesdayPrompt && (
        <TuesdayCheckinModal
          open={tuesdayOpen}
          onOpenChange={setTuesdayOpen}
          prompt={tuesdayPrompt}
          checkin={tuesdayCheckin}
        />
      )}
    </div>
  );
}
