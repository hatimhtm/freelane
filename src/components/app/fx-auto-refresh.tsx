"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { refreshRatesIfStale } from "@/lib/data/actions";

// Mounts once in the app shell. Throttled to one check per 6h via localStorage,
// so it doesn't hammer frankfurter on every navigation. The server action only
// fetches when the rates are actually stale.
export function FxAutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const KEY = "freelane.fxCheckedAt";
    const last = Number(window.localStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 6 * 3_600_000) return;
    window.localStorage.setItem(KEY, String(Date.now()));
    refreshRatesIfStale()
      .then((r) => { if (r.refreshed) router.refresh(); })
      .catch(() => {});
  }, [router]);
  return null;
}
