/*
 * Freelane Service Worker — Web Push delivery + click routing.
 *
 * Lives at /public/sw.js so Next serves it from the root with default scope
 * '/'. DO NOT add a rewrite that masks /sw.js in next.config.ts — the SW's
 * scope is inferred from its served path, and a rewrite breaks subscription
 * silently.
 *
 * Registered conditionally by src/components/app/service-worker-registrar.tsx
 * only when the user has opted into push from Settings → Notifications.
 *
 * The push payload is the JSON object the server sends via web-push:
 *   { id, subject, body?, link_url?, silent? }
 *
 * `silent: true` honors the per-kind sound preference — the OS shows the
 * notification but suppresses the alert sound.
 *
 * The tag = id makes a re-fired notification with the same id replace the
 * existing one (native dedup) instead of stacking.
 */

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = payload.subject || "Freelane";
  const options = {
    body: payload.body || "",
    tag: payload.id || undefined,
    silent: payload.silent === true,
    data: {
      id: payload.id || null,
      link_url: payload.link_url || null,
    },
    icon: "/icon-192.png",
    badge: "/icon-192.png",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const id = data.id;
  // Always land on origin root with ?notification=<id> — the in-app
  // interceptor at src/components/app/notification-link-interceptor.tsx
  // catches the param, marks read, and routes through KIND_HANDLERS.
  const targetPath = id ? `/?notification=${encodeURIComponent(id)}` : "/";

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const origin = self.location.origin;
      for (const client of all) {
        try {
          if (new URL(client.url).origin === origin) {
            await client.focus();
            if ("navigate" in client && typeof client.navigate === "function") {
              await client.navigate(targetPath);
            } else {
              client.postMessage({ type: "freelane.notification", id });
            }
            return;
          }
        } catch {
          // ignore malformed client URLs
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetPath);
      }
    })(),
  );
});
