"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setPushEnabledAction } from "@/lib/notifications/actions";

type Props = {
  pushEnabled: boolean;
  vapidPublicKey: string | null;
};

// Converts a base64-url-encoded VAPID public key to the Uint8Array the
// PushManager API requires for applicationServerKey.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const padded = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function PushToggle({ pushEnabled, vapidPublicKey }: Props) {
  const [enabled, setEnabled] = useState(pushEnabled);
  const [pending, start] = useTransition();
  // Subscriptions are per-DEVICE; push_enabled is a per-USER flag. If the
  // server says push is on but this browser has no local subscription
  // (different device, cleared storage, switched browsers), we show a
  // hint so the user knows they need to re-enable here.
  const [enabledOnOtherDevice, setEnabledOnOtherDevice] = useState(false);

  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window;

  useEffect(() => {
    if (!pushEnabled || !supported) return;
    let cancelled = false;
    void (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (cancelled) return;
        if (!sub) setEnabledOnOtherDevice(true);
      } catch {
        // Best-effort — leave the hint hidden if the lookup fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pushEnabled, supported]);

  const enable = async () => {
    if (!supported) {
      toast.error("Push isn't supported in this browser.");
      return;
    }
    if (!vapidPublicKey) {
      toast.error("Push isn't configured yet — missing VAPID public key.");
      return;
    }
    // TRIPWIRE: Notification.requestPermission() must remain on the
    // synchronous user-activation chain from the Switch's onCheckedChange
    // click. Safari and Firefox both drop the prompt (or treat it as denied)
    // if the call happens after an `await` that breaks the user-gesture
    // chain. If you refactor this handler — e.g. add a pre-flight `await`
    // before this line, move the call out of the React transition, or
    // schedule it via setTimeout/microtask — re-verify the permission
    // prompt still appears in Safari and Firefox before merging.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      toast.error("Notifications permission was denied.");
      return;
    }
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      // applicationServerKey expects BufferSource — Uint8Array<ArrayBuffer>
      // is the canonical shape; the as-cast sidesteps the SharedArrayBuffer
      // union in the lib types without changing the runtime value.
      const key = urlBase64ToUint8Array(vapidPublicKey);
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key as unknown as BufferSource,
      });
    }
    const json = sub.toJSON();
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: json.keys,
        userAgent: navigator.userAgent,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(body.error || "Couldn't enable push.");
      return;
    }
    const settingsRes = await setPushEnabledAction(true);
    if (!settingsRes.ok) {
      toast.error(settingsRes.error || "Saved push but settings update failed.");
      return;
    }
    setEnabled(true);
    setEnabledOnOtherDevice(false);
    toast.success("Push enabled.");
  };

  const disable = async () => {
    if (!supported) {
      const settingsRes = await setPushEnabledAction(false);
      if (settingsRes.ok) setEnabled(false);
      return;
    }
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => {});
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
      }
    } catch {
      // Even if the local unsubscribe fails, flip the server flag so the
      // dispatcher stops pushing.
    }
    const settingsRes = await setPushEnabledAction(false);
    if (!settingsRes.ok) {
      toast.error(settingsRes.error || "Couldn't disable push.");
      return;
    }
    setEnabled(false);
    toast.success("Push disabled.");
  };

  const onCheckedChange = (next: boolean) => {
    start(async () => {
      if (next) {
        await enable();
      } else {
        await disable();
      }
    });
  };

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium">Browser push</div>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          Native OS notifications even when Freelane isn&apos;t focused. Per-kind push is off by default — flip each kind on below to start receiving it on the OS.
        </p>
        {!supported && (
          <p className="mt-1 text-[10px] text-rose-500/80">
            Not supported in this browser.
          </p>
        )}
        {!vapidPublicKey && (
          <p className="mt-1 text-[10px] text-rose-500/80">
            Server VAPID keys aren&apos;t set — push won&apos;t deliver yet.
          </p>
        )}
        {enabledOnOtherDevice && supported && (
          <p className="mt-1 text-[10px] text-muted-foreground">
            Enabled on another device — re-enable here to receive on this browser too.
          </p>
        )}
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={(c) => onCheckedChange(c === true)}
        disabled={pending || !supported}
      />
    </div>
  );
}
