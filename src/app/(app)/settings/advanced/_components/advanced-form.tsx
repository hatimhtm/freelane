"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { refreshRatesIfStale } from "@/lib/data/actions";

// Client-side view-state keys the app persists per-browser. "Reset layouts"
// wipes these so the wallet grids fall back to their server order. Keep this
// list in sync with the STORAGE_KEY constants in payments-view + wallet-stack.
const LAYOUT_KEYS = [
  "freelane:payments:wallet-order:v1",
  "freelane:dashboard:wallet-order:v1",
];

export function AdvancedForm() {
  const router = useRouter();
  const [refreshing, start] = useTransition();
  const [resetDone, setResetDone] = useState(false);

  function refreshRates() {
    start(async () => {
      try {
        // maxAge 0 forces a fetch regardless of how fresh the stored rates are.
        const res = await refreshRatesIfStale(0);
        toast.success(
          res.refreshed
            ? "Exchange rates refreshed from the ECB feed."
            : "Rates checked — nothing to update.",
        );
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message || "Couldn't reach the rate feed.");
      }
    });
  }

  function resetLayouts() {
    try {
      for (const key of LAYOUT_KEYS) window.localStorage.removeItem(key);
      setResetDone(true);
      toast.success("Saved wallet layouts cleared — they'll rebuild on next load.");
      router.refresh();
    } catch {
      toast.error("This browser blocked local storage, so there's nothing to clear.");
    }
  }

  return (
    <div className="space-y-2.5">
      <ToolRow
        icon={<RefreshCw className="h-4 w-4 text-muted-foreground" />}
        title="Refresh exchange rates now"
        description="Pull fresh ECB rates immediately instead of waiting for the daily staleness check. Locked (paid) amounts are never touched."
        action={
          <Button variant="outline" size="sm" onClick={refreshRates} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />
      <ToolRow
        icon={<LayoutGrid className="h-4 w-4 text-muted-foreground" />}
        title="Reset saved layouts"
        description="Clear this browser's custom wallet card ordering on Payments and the Dashboard. Your data isn't affected."
        action={
          <Button variant="outline" size="sm" onClick={resetLayouts} disabled={resetDone}>
            {resetDone ? "Cleared" : "Reset"}
          </Button>
        }
      />
    </div>
  );
}

function ToolRow({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs leading-snug text-muted-foreground">{description}</div>
        </div>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}
