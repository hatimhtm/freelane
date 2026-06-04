"use client";

import { useEffect } from "react";

// Registers /sw.js for every signed-in session. Registration runs on every
// load so the browser checks for an updated sw.js — this is how the corrected,
// fetch-handler-FREE service worker reaches anyone who previously received the
// broken navigation-intercepting version and evicts it (that SW used
// skipWaiting + clients.claim). The SW itself is push-only; it does NOT touch
// page loads. The `enabled` prop (push opt-in, resolved server-side in the
// (app) layout) is kept for callers but no longer gates registration.
//
// Skips on unsupported browsers (no navigator.serviceWorker — e.g. private
// Firefox). Idempotent: navigator.serviceWorker.register dedupes by scope.

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
