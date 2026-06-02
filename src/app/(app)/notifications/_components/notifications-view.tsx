"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Notification } from "@/lib/notifications/dispatcher";
import {
  clearDismissedAction,
  dismissNotificationAction,
  markAllReadAction,
  markNotificationReadAction,
} from "@/lib/notifications/actions";
import { routeNotificationClick } from "@/lib/notifications/click-routing";
import { iconForKind } from "@/lib/notifications/kinds";
import { relativeTime } from "@/lib/notifications/types";
import { useNotificationModal } from "@/components/app/notification-modal-host";
import { TuesdayCheckinLoader } from "@/components/app/tuesday-checkin-loader";
import { EmptyState } from "@/components/app/empty-state";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type Props = {
  rows: Notification[];
  icon?: LucideIcon;
  retentionDays: number;
  retentionForever: boolean;
  // Backward-compat: the older Today→notifications hand-off used
  // ?open=tuesday. The click-routing registry replaces this convention,
  // but in-flight rows that already have the old link_url still arrive
  // here, so we honor the query param for one release.
  legacyOpenTuesday?: boolean;
};

function deletionCountdown(
  readIso: string | null,
  retentionDays: number,
  retentionForever: boolean,
): string | null {
  if (retentionForever) return "kept forever";
  if (!readIso) return null;
  const ageMs = Date.now() - new Date(readIso).getTime();
  const remainingDays = retentionDays - ageMs / 86_400_000;
  if (remainingDays <= 0) return "deleting soon";
  if (remainingDays < 1) return "deletes in <1d";
  return `deletes in ${Math.ceil(remainingDays)}d`;
}

export function NotificationsView({
  rows,
  icon: Icon = Bell,
  retentionDays,
  retentionForever,
  legacyOpenTuesday = false,
}: Props) {
  const router = useRouter();
  const { openModal } = useNotificationModal();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState(rows);

  // Backward-compat: ?open=tuesday — synthesize a click on the most recent
  // tuesday_checkin row through the registry.
  useEffect(() => {
    if (!legacyOpenTuesday) return;
    const tuesday = rows.find((r) => r.kind === "tuesday_checkin");
    if (!tuesday) return;
    openModal(<TuesdayCheckinLoader notification={tuesday} />, {
      title: "Tuesday check-in",
      description: "A line and two numbers. The echo lands after you save.",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legacyOpenTuesday]);

  const { unread, read } = useMemo(() => {
    const unread: Notification[] = [];
    const read: Notification[] = [];
    for (const n of optimistic) {
      if (n.read_at) read.push(n);
      else unread.push(n);
    }
    return { unread, read };
  }, [optimistic]);

  const openNotification = (n: Notification) => {
    setOptimistic((cur) =>
      cur.map((row) =>
        row.id === n.id
          ? { ...row, read_at: row.read_at ?? new Date().toISOString() }
          : row,
      ),
    );
    startTransition(async () => {
      await markNotificationReadAction(n.id);
    });
    routeNotificationClick(n, openModal, (href) => router.push(href));
  };

  const dismiss = (id: string) => {
    setOptimistic((cur) => cur.filter((row) => row.id !== id));
    startTransition(async () => {
      await dismissNotificationAction(id);
    });
  };

  const markAll = () => {
    setOptimistic((cur) =>
      cur.map((row) => ({
        ...row,
        read_at: row.read_at ?? new Date().toISOString(),
      })),
    );
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

  const renderList = (list: Notification[], variant: "unread" | "read") => {
    if (list.length === 0) {
      return (
        <div className="rounded-xl border border-border/60 bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          {variant === "unread" ? "Nothing new." : "Nothing read yet."}
        </div>
      );
    }
    return (
      <ul className="overflow-hidden rounded-xl border border-border/60 bg-card">
        {list.map((n, idx) => {
          const KindIcon = iconForKind(n.kind);
          return (
          <li
            key={n.id}
            className={cn(
              "group flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-foreground/[0.025]",
              idx > 0 && "border-t border-border/40",
              n.priority >= 2 && "ring-1 ring-rose-500/15",
            )}
          >
            <KindIcon
              aria-hidden
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0",
                variant === "read" ? "text-muted-foreground/70" : "text-muted-foreground",
              )}
            />
            <button
              type="button"
              onClick={() => openNotification(n)}
              className="flex-1 cursor-pointer text-left"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={cn(
                    "text-[14px] leading-snug",
                    variant === "read"
                      ? "text-foreground/70"
                      : "font-medium text-foreground",
                  )}
                >
                  {n.subject}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                  {relativeTime(n.created_at)}
                </span>
              </div>
              {n.body && (
                <p
                  className={cn(
                    "mt-1 text-[12.5px] leading-snug",
                    variant === "read"
                      ? "text-muted-foreground/80"
                      : "text-muted-foreground",
                  )}
                >
                  {n.body}
                </p>
              )}
              <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
                <span>{n.kind.replace(/_/g, " ")}</span>
                {variant === "read" && (
                  <span>
                    {deletionCountdown(
                      n.read_at,
                      retentionDays,
                      retentionForever,
                    )}
                  </span>
                )}
              </div>
            </button>
            <div className="flex shrink-0 items-center gap-1">
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
          );
        })}
      </ul>
    );
  };

  const total = optimistic.length;
  const unreadCount = unread.length;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 md:px-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Inbox
          </div>
          <h1 className="display-headline mt-1 text-3xl md:text-4xl">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total === 0
              ? "Nothing in the inbox yet."
              : `${unreadCount} unread of ${total}.`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[12px]">
          {unreadCount > 0 && (
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
        <Tabs defaultValue="unread">
          <TabsList>
            <TabsTrigger value="unread">
              Unread{unreadCount > 0 && ` · ${unreadCount}`}
            </TabsTrigger>
            <TabsTrigger value="read">Read · {read.length}</TabsTrigger>
          </TabsList>
          <TabsContent value="unread">{renderList(unread, "unread")}</TabsContent>
          <TabsContent value="read">{renderList(read, "read")}</TabsContent>
        </Tabs>
      )}
    </div>
  );
}
