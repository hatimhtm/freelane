"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useNotificationModal } from "@/components/app/notification-modal-host";
import {
  getNotificationByIdAction,
  markNotificationReadAction,
} from "@/lib/notifications/actions";
import { routeNotificationClick } from "@/lib/notifications/click-routing";

// Catches the ?notification=<id> query param the Service Worker's
// notificationclick handler appends when the user taps a push notification.
// Marks the row read, dispatches through the click-routing registry, then
// strips the param via router.replace so a back-nav doesn't re-fire.
//
// Uses window.location directly to sidestep useSearchParams (which would
// drag the whole app layout into a Suspense boundary).

export function NotificationLinkInterceptor() {
  const router = useRouter();
  const pathname = usePathname();
  const { openModal } = useNotificationModal();
  const handledIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("notification");
    if (!id) return;
    if (handledIdRef.current === id) return;
    handledIdRef.current = id;

    void (async () => {
      const res = await getNotificationByIdAction(id);
      if (res.ok && res.data) {
        void markNotificationReadAction(id);
        routeNotificationClick(res.data, openModal, (href) => router.push(href));
      }
      // Strip the param regardless so a refresh doesn't re-trigger.
      const next = new URLSearchParams(window.location.search);
      next.delete("notification");
      const q = next.toString();
      router.replace(`${pathname}${q ? `?${q}` : ""}`);
    })();
  }, [openModal, pathname, router]);

  return null;
}
