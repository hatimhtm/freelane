"use client";

import { useEffect } from "react";

// Registers /sw.js ONLY when the user has opted into push. The opt-in lives
// in finance.notification_settings.push_enabled and is passed in as a prop
// (resolved server-side in the (app) layout). Skips on unsupported
// browsers (no navigator.serviceWorker — e.g. private Firefox).
//
// Idempotent: navigator.serviceWorker.register dedupes by scope, so a
// repeated registration just returns the existing one.

export function ServiceWorkerRegistrar({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Silent failure — push opt-in surface in Settings handles
      // explicit re-registration errors.
    });
  }, [enabled]);
  return null;
}
