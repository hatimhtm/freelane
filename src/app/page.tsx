import { redirect } from "next/navigation";

// T01 — root redirects to /dashboard. The new home is the bird's-eye view;
// /today is the lean glance-only page.
//
// Preserve searchParams across the redirect. Critical for ?notification=<id>:
// the Service Worker (public/sw.js) opens /?notification=<id> on push click,
// and the NotificationLinkInterceptor mounted in (app)/layout.tsx reads the
// param to mark read + dispatch routing. Stripping the search would silently
// break every SW-originated open.
export default async function RootPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const entries: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      entries.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
    }
  }
  const qs = entries.length > 0 ? `?${entries.join("&")}` : "";
  redirect(`/dashboard${qs}`);
}
