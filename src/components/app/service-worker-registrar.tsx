"use client";

import { useEffect } from "react";

// HARD SERVICE-WORKER REMOVAL.
//
// A previous version of this app shipped a service worker that intercepted
// page navigations. In standalone WebKit web apps AND ordinary browsers it
// broke loading across the whole origin (30s hangs / "This page couldn't
// load"), because a service worker controls every tab on the domain, not just
// the installed PWA. A code revert can't fix that — the broken worker is
// already registered on the user's device.
//
// So this component's only job now is to UNREGISTER any service worker still
// present and drop its control immediately. We do NOT register a worker, so a
// broken one cannot come back. (Push notifications are off until a safe worker
// is reintroduced deliberately — correctness first.)
//
// Loop-safe: we reload exactly once, and only if we actually removed a
// registration. A clean session (no worker) does nothing.

export function ServiceWorkerRegistrar(_props: { enabled: boolean }) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => {
        if (!regs.length) return;
        Promise.all(regs.map((r) => r.unregister().catch(() => false))).then(
          (results) => {
            // Only reload when we genuinely removed a worker — the page is
            // still controlled by it until a reload drops that control.
            if (results.some(Boolean)) window.location.reload();
          },
        );
      })
      .catch(() => {});
  }, []);
  return null;
}
