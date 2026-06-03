"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useNotificationModal } from "@/components/app/notification-modal-host";
import {
  getNotificationByIdAction,
  markNotificationReadAction,
} from "@/lib/notifications/actions";
import { routeNotificationClick } from "@/lib/notifications/click-routing";

// Catches notification clicks from two paths:
//   1. The ?notification=<id> query param the Service Worker appends when
//      the user taps a push notification from a non-(app) tab (forces a
//      navigation to / so the interceptor mounts).
//   2. The 'freelane.notification' postMessage the SW sends when an
//      (app) tab is already focused — handled in-place without a
//      navigation so modals / chat input / scroll are preserved.
//
// In both paths we mark the row read, dispatch through the click-routing
// registry, then (for the query param path) strip the param via
// router.replace so a back-nav doesn't re-fire.
//
// Uses window.location directly to sidestep useSearchParams (which would
// drag the whole app layout into a Suspense boundary).

export function NotificationLinkInterceptor() {
  const router = useRouter();
  const pathname = usePathname();
  const { openModal } = useNotificationModal();
  const handledIdsRef = useRef<Set<string>>(new Set());

  const handleNotification = useCallback(
    async (id: string) => {
      if (handledIdsRef.current.has(id)) return;
      handledIdsRef.current.add(id);
      const res = await getNotificationByIdAction(id);
      if (res.ok && res.data) {
        void markNotificationReadAction(id);
        routeNotificationClick(res.data, openModal, (href) => router.push(href));
      }
    },
    [openModal, router],
  );

  // Query-param path — query string written by the SW fallback navigate.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("notification");
    if (!id) return;

    void (async () => {
      await handleNotification(id);
      // Strip the param regardless so a refresh doesn't re-trigger.
      const next = new URLSearchParams(window.location.search);
      next.delete("notification");
      const q = next.toString();
      router.replace(`${pathname}${q ? `?${q}` : ""}`);
    })();
  }, [handleNotification, pathname, router]);

  // postMessage path — primary path when an (app) tab is already focused.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
    function onMessage(event: MessageEvent) {
      const data = event.data as
        | { type?: string; id?: string }
        | undefined;
      if (!data || data.type !== "freelane.notification" || !data.id) return;
      void handleNotification(data.id);
    }
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, [handleNotification]);

  return null;
}
