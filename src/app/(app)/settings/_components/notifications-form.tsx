"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { saveNotificationPrefsAction } from "@/lib/notifications/actions";
import type { NotificationPrefs } from "@/lib/notifications/dispatcher";

const KINDS: { key: string; label: string; description: string }[] = [
  { key: "tuesday_checkin", label: "Tuesday check-in", description: "A line and two numbers each Tuesday morning." },
  { key: "ai_question", label: "AI questions", description: "The brain asks for clarification on a spend, plan, or client." },
  { key: "plan_due", label: "Plan due", description: "Quiet reminder a plan's due date is near." },
  { key: "wallet_anchor_stale", label: "Wallet anchor stale", description: "A holding wallet hasn't been re-anchored in a long while." },
  { key: "recovery_complete", label: "Recovery complete", description: "Heads-up when a recovery period closes out." },
];

export function NotificationsForm({ initial }: { initial: NotificationPrefs }) {
  const [prefs, setPrefs] = useState<NotificationPrefs>(initial);
  const [pending, start] = useTransition();

  const toggle = (kind: string, key: "in_app" | "email", value: boolean) => {
    const next = {
      ...prefs,
      [kind]: { ...(prefs[kind] ?? {}), [key]: value },
    };
    setPrefs(next);
    start(async () => {
      const res = await saveNotificationPrefsAction(next);
      if (!res.ok) toast.error(res.error);
    });
  };

  return (
    <div className="space-y-3">
      {KINDS.map((k) => {
        const inApp = prefs[k.key]?.in_app !== false;
        const email = prefs[k.key]?.email === true;
        return (
          <div key={k.key} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-sm font-medium">{k.label}</div>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                {k.description}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>In-app</span>
                <Switch
                  checked={inApp}
                  onCheckedChange={(c) => toggle(k.key, "in_app", c === true)}
                  disabled={pending}
                />
              </label>
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>Email</span>
                <Switch
                  checked={email}
                  onCheckedChange={(c) => toggle(k.key, "email", c === true)}
                  disabled={pending}
                />
              </label>
            </div>
          </div>
        );
      })}
      <p className="text-[11px] text-muted-foreground/80">
        Email delivery is a stub for now — only in-app fires.
      </p>
    </div>
  );
}
