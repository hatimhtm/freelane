"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Notification } from "@/lib/notifications/dispatcher";
import {
  dismissNotificationAction,
  markAllReadAction,
  markNotificationReadAction,
} from "@/lib/notifications/actions";
import { cn } from "@/lib/utils";
import { BRAND_LIME_VAR_CLASS } from "@/lib/design/tokens";

type Props = {
  unread: number;
  open: Notification[];
};

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

export function NotificationsPopover({ unread, open }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Action results surface failures via toast so the bell never gets stuck
  // (silent stuck rows used to look like an unread regression).
  const handleOpen = (n: Notification) => {
    startTransition(async () => {
      const res = await markNotificationReadAction(n.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (n.link_url) router.push(n.link_url);
      else router.push("/notifications");
    });
  };

  const handleDismiss = (id: string) => {
    startTransition(async () => {
      const res = await dismissNotificationAction(id);
      if (!res.ok) toast.error(res.error);
    });
  };

  const handleMarkAll = () => {
    startTransition(async () => {
      const res = await markAllReadAction();
      if (!res.ok) toast.error(res.error);
    });
  };

  return (
    <Popover>
      <PopoverTrigger
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        className="relative grid h-9 w-9 place-items-center rounded-full text-foreground/70 transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span
            className={cn(
              "pointer-events-none absolute right-1.5 top-1.5 inline-flex h-2 w-2 animate-breathe rounded-full",
              BRAND_LIME_VAR_CLASS,
            )}
            aria-hidden
          />
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Bell className="h-4 w-4 text-muted-foreground" />
            Notifications
          </div>
          {open.length > 0 && (
            <button
              type="button"
              onClick={handleMarkAll}
              disabled={pending}
              className="text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              Mark all read
            </button>
          )}
        </div>
        {open.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            <p>Nothing new.</p>
            <p className="mt-1 text-[11px]">The bell breathes when something needs you.</p>
          </div>
        ) : (
          <ul className="max-h-[460px] overflow-y-auto">
            {open.map((n) => (
              <li
                key={n.id}
                className={cn(
                  "group flex items-start gap-3 border-b border-border/40 px-4 py-3 transition-colors last:border-b-0 hover:bg-foreground/[0.025]",
                  n.priority >= 2 && "ring-1 ring-rose-500/15",
                )}
              >
                <button
                  type="button"
                  onClick={() => handleOpen(n)}
                  className="flex-1 cursor-pointer text-left"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium leading-snug text-foreground">
                      {n.subject}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {relativeTime(n.created_at)}
                    </span>
                  </div>
                  {n.body && (
                    <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground">
                      {n.body}
                    </p>
                  )}
                </button>
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    aria-label="Mark read"
                    onClick={(e) => {
                      e.stopPropagation();
                      startTransition(async () => {
                        const res = await markNotificationReadAction(n.id);
                        if (!res.ok) toast.error(res.error);
                      });
                    }}
                    className="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
                  >
                    <Check className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDismiss(n.id);
                    }}
                    className="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-rose-500"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t border-border/50 px-4 py-2.5 text-center">
          <Link
            href="/notifications"
            className="text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            See all
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
