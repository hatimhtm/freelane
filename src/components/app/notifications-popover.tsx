"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, Settings as SettingsIcon, X } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import type { Notification } from "@/lib/notifications/dispatcher";
import {
  dismissNotificationAction,
  markAllReadAction,
  markNotificationReadAction,
  saveRetentionAction,
} from "@/lib/notifications/actions";
import { routeNotificationClick } from "@/lib/notifications/click-routing";
import { iconForKind } from "@/lib/notifications/kinds";
import { relativeTime } from "@/lib/notifications/types";
import { useNotificationModal } from "@/components/app/notification-modal-host";
import { cn } from "@/lib/utils";
import { BRAND_LIME_VAR_CLASS } from "@/lib/design/tokens";

type Props = {
  unread: number;
  open: Notification[];
  read: Notification[];
  retentionDays: number;
  retentionForever: boolean;
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

export function NotificationsPopover({
  unread,
  open,
  read,
  retentionDays,
  retentionForever,
}: Props) {
  const router = useRouter();
  const { openModal } = useNotificationModal();
  const [pending, startTransition] = useTransition();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [retentionOpen, setRetentionOpen] = useState(false);
  const [retentionValue, setRetentionValue] = useState<string>(
    retentionForever ? "forever" : String(retentionDays),
  );
  const [retentionPending, startRetention] = useTransition();

  const handleClickRow = (n: Notification) => {
    // Body click ALWAYS marks read, even when the registry decides to do
    // nothing (e.g. info kind).
    startTransition(async () => {
      const res = await markNotificationReadAction(n.id);
      if (!res.ok) toast.error(res.error);
    });
    setPopoverOpen(false);
    routeNotificationClick(n, openModal, (href) => router.push(href));
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

  const handleRetentionChange = (next: string) => {
    setRetentionValue(next);
    startRetention(async () => {
      const res = await saveRetentionAction(
        next === "forever" ? "forever" : Number(next),
      );
      if (!res.ok) toast.error(res.error || "Couldn't save.");
    });
  };

  const RETENTION_OPTIONS: { value: string; label: string }[] = [
    { value: "1", label: "1 day" },
    { value: "3", label: "3 days" },
    { value: "7", label: "7 days" },
    { value: "30", label: "30 days" },
    { value: "forever", label: "Forever" },
  ];

  const renderRow = (n: Notification, variant: "unread" | "read") => {
    const KindIcon = iconForKind(n.kind);
    return (
    <li
      key={n.id}
      className={cn(
        "group flex items-start gap-3 border-b border-border/40 px-4 py-3 transition-colors last:border-b-0 hover:bg-foreground/[0.025]",
        n.priority >= 2 && "ring-1 ring-rose-500/15",
      )}
    >
      <KindIcon
        aria-hidden
        className={cn(
          "mt-0.5 h-3.5 w-3.5 shrink-0",
          variant === "read" ? "text-muted-foreground/70" : "text-muted-foreground",
        )}
      />
      <button
        type="button"
        onClick={() => handleClickRow(n)}
        className="flex-1 cursor-pointer text-left"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "text-sm leading-snug",
              variant === "read"
                ? "text-foreground/70"
                : "font-medium text-foreground",
            )}
          >
            {n.subject}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {relativeTime(n.created_at)}
          </span>
        </div>
        {n.body && (
          <p
            className={cn(
              "mt-0.5 line-clamp-2 text-[12px] leading-snug",
              variant === "read"
                ? "text-muted-foreground/80"
                : "text-muted-foreground",
            )}
          >
            {n.body}
          </p>
        )}
        {variant === "read" && (
          <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
            {deletionCountdown(n.read_at, retentionDays, retentionForever) ?? ""}
          </p>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-1">
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
    );
  };

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
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
      <PopoverContent align="end" className="w-[380px] p-0">
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Bell className="h-4 w-4 text-muted-foreground" />
            Notifications
          </div>
          <div className="flex items-center gap-2">
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
            <DropdownMenu open={retentionOpen} onOpenChange={setRetentionOpen}>
              <DropdownMenuTrigger
                aria-label="Read-tab retention"
                disabled={retentionPending}
                className="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-50"
              >
                <SettingsIcon className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Delete read after</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup
                  value={retentionValue}
                  onValueChange={handleRetentionChange}
                >
                  {RETENTION_OPTIONS.map((o) => (
                    <DropdownMenuRadioItem key={o.value} value={o.value}>
                      {o.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <Link
                  href="/settings/notifications"
                  onClick={() => {
                    setRetentionOpen(false);
                    setPopoverOpen(false);
                  }}
                  className="block px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  All notification settings
                </Link>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <Tabs defaultValue="unread" className="gap-0">
          <div className="border-b border-border/50 px-3 pt-2">
            <TabsList variant="line">
              <TabsTrigger value="unread">
                Unread{unread > 0 && ` · ${unread}`}
              </TabsTrigger>
              <TabsTrigger value="read">
                Read{read.length > 0 && ` · ${read.length}`}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="unread">
            {open.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                <p>Nothing new.</p>
                <p className="mt-1 text-[11px]">
                  The bell breathes when something needs you.
                </p>
              </div>
            ) : (
              <ul className="max-h-[460px] overflow-y-auto">
                {open.map((n) => renderRow(n, "unread"))}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="read">
            {read.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                <p>Nothing read yet.</p>
              </div>
            ) : (
              <ul className="max-h-[460px] overflow-y-auto">
                {read.map((n) => renderRow(n, "read"))}
              </ul>
            )}
          </TabsContent>
        </Tabs>

        <div className="border-t border-border/50 px-4 py-2.5 text-center">
          <Link
            href="/notifications"
            className="text-[12px] text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setPopoverOpen(false)}
          >
            See all
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
