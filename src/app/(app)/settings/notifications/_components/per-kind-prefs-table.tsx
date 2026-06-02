"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { savePerKindPrefAction } from "@/lib/notifications/actions";
import { KNOWN_KINDS } from "@/lib/notifications/kinds";
import type {
  PerKindPref,
  PerKindPrefs,
} from "@/lib/notifications/types";
import { effectivePerKindPref } from "@/lib/notifications/types";

type Props = {
  initial: PerKindPrefs;
  // Legacy notification_prefs (in_app/email shape) — read so the in_app
  // toggle defaults match what the user previously set on the old page.
  legacy: Record<string, { in_app?: boolean; email?: boolean }>;
};

export function PerKindPrefsTable({ initial, legacy }: Props) {
  const [prefs, setPrefs] = useState<PerKindPrefs>(initial);
  const [pending, start] = useTransition();
  // Serialize per-kind writes to avoid the race where two concurrent
  // savePerKindPrefAction calls each read the same starting
  // per_kind_prefs and the later one clobbers the earlier change. The
  // queue chains every save onto the previous one.
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const toggle = (
    key: string,
    field: keyof PerKindPref,
    value: boolean,
  ) => {
    const current = effectivePerKindPref(prefs, legacy, key);
    const next: PerKindPrefs = {
      ...prefs,
      [key]: { ...current, [field]: value },
    };
    setPrefs(next);
    const task = async () => {
      const res = await savePerKindPrefAction(key, { [field]: value });
      if (!res.ok) toast.error(res.error || "Couldn't save.");
    };
    queueRef.current = queueRef.current.then(
      () =>
        new Promise<void>((resolve) => {
          start(async () => {
            await task();
            resolve();
          });
        }),
    );
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-b border-border/40 bg-muted/30 px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        <span>Kind</span>
        <span className="w-12 text-center">In-app</span>
        <span className="w-12 text-center">Push</span>
        <span className="w-12 text-center">Sound</span>
      </div>
      {KNOWN_KINDS.map((k) => {
        const ep = effectivePerKindPref(prefs, legacy, k.key);
        return (
          <div
            key={k.key}
            className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-b border-border/40 bg-card px-3 py-2.5 last:border-b-0"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium">{k.label}</div>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                {k.description}
              </p>
            </div>
            <div className="w-12 text-center">
              <Switch
                checked={ep.in_app}
                onCheckedChange={(c) => toggle(k.key, "in_app", c === true)}
                disabled={pending}
              />
            </div>
            <div className="w-12 text-center">
              <Switch
                checked={ep.push}
                onCheckedChange={(c) => toggle(k.key, "push", c === true)}
                disabled={pending}
              />
            </div>
            <div className="w-12 text-center">
              <Switch
                checked={ep.sound}
                onCheckedChange={(c) => toggle(k.key, "sound", c === true)}
                disabled={pending}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
