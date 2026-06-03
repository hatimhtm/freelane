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
 *
 * Click routing:
 *   - If an (app) tab is already focused (any same-origin client whose
 *     pathname looks like an (app) route), we postMessage the
 *     notification id so the in-app interceptor handles the routing
 *     WITHOUT a full navigation. That preserves any in-flight modal,
 *     chatbot input, or scroll position.
 *   - Otherwise we fall back to navigate('/?notification=<id>') which
 *     lands on the dashboard with the query param the interceptor reads.
 *   - With no open client at all, openWindow boots a fresh tab.
 */

// The Dashboard LIVES at `/` per the 2026-06-02 lock. Treat bare-root
// requests as an app route so a push fired while the user is on the
// dashboard takes the postMessage path (preserves modals / scroll /
// chatbot input) instead of falling through to client.navigate('/?…')
// which would nuke the in-flight state.
const APP_ROUTE_PATTERN = /^\/(?:$|today|dashboard|spending|payments|projects|plans|clients|notifications|stats|sadaka|letters|activity|settings|should-i-buy)/i;

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
  // Fallback path — lands on origin root with ?notification=<id>. The
  // in-app interceptor at src/components/app/notification-link-interceptor.tsx
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
          const url = new URL(client.url);
          if (url.origin !== origin) continue;
          await client.focus();
          // If the focused client is already on an (app) route, prefer
          // postMessage so the interceptor handles the click in-place —
          // no navigation, no thrash of modals or scroll. Explicit `/`
          // branch covers the Dashboard at root in case a future regex
          // edit drifts on the bare-root case.
          if (url.pathname === "/" || APP_ROUTE_PATTERN.test(url.pathname)) {
            client.postMessage({ type: "freelane.notification", id });
            return;
          }
          // Non-(app) route (e.g. /login) — navigate so the (app)
          // interceptor mounts. Fall back to postMessage when navigate
          // isn't available (older browsers).
          if ("navigate" in client && typeof client.navigate === "function") {
            await client.navigate(targetPath);
          } else {
            client.postMessage({ type: "freelane.notification", id });
          }
          return;
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
