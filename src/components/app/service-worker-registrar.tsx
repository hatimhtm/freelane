"use client";

import { useEffect } from "react";

// Registers /sw.js for EVERY signed-in session. It used to register only when
// the user had opted into push, but the SW now also provides navigation
// resilience (a self-healing "Reconnecting…" fallback when the dock/standalone
// web app reloads during a network blip), which everyone benefits from — not
// just push users. The `enabled` prop (push opt-in, resolved server-side in
// the (app) layout) is kept for callers but no longer gates registration.
//
// Skips on unsupported browsers (no navigator.serviceWorker — e.g. private
// Firefox). Idempotent: navigator.serviceWorker.register dedupes by scope, so
// a repeated registration just returns the existing one, and the browser
// picks up a byte-changed sw.js on the next load.

export function ServiceWorkerRegistrar({ enabled: _enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Silent failure — push opt-in surface in Settings handles
      // explicit re-registration errors.
    });
  }, []);
  return null;
}
