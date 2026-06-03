"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import type {
  ChangelogEntry,
  ChangelogSectionKey,
} from "@/lib/changelog/load";
import { markUpdatesSeen } from "@/lib/data/actions";

// Freelane "Updates" section. Renders the parsed CHANGELOG.md entries
// most-recent first. The latest non-Unreleased entry auto-expands; the
// rest stay collapsed behind a chevron toggle. On mount we:
//   1. Mark the current version as seen on the server (clears the nav
//      dot the Settings landing renders).
//   2. Fire the /api/check-updates probe so the user sees the freshest
//      banner state without waiting for the daily cron.
//
// The `?expand=<version>` query string opens a specific entry on
// arrival. The `app_update_available` notification handler uses this to
// land users directly on the new release.

const SECTION_LABEL: Record<ChangelogSectionKey, string> = {
  added: "Added",
  changed: "Changed",
  fixed: "Fixed",
  removed: "Removed",
  security: "Security",
  deprecated: "Deprecated",
};

const SECTION_ORDER: ChangelogSectionKey[] = [
  "added",
  "changed",
  "fixed",
  "removed",
  "security",
  "deprecated",
];

export function UpdatesSection({
  entries,
  currentVersion,
  lastSeenVersion = null,
}: {
  entries: ChangelogEntry[];
  currentVersion: string;
  /**
   * Server-passed cache of `settings.last_seen_version` so the on-mount
   * markUpdatesSeen() call can no-op when the user is already on the
   * current build. Skipping the round-trip when there's nothing to
   * update keeps the dashboard quiet during soft-navigations.
   */
  lastSeenVersion?: string | null;
}) {
  const params = useSearchParams();
  const expandParam = params.get("expand");

  const initialOpen = useMemo(() => {
    const set = new Set<string>();
    // Deep-link wins: if the URL points at a real entry, open ONLY
    // that one. Otherwise fall back to the latest non-Unreleased entry.
    // Opening both creates visual confusion when the notification
    // handler lands the user on a specific release.
    if (expandParam && entries.some((e) => e.version === expandParam)) {
      set.add(expandParam);
      return set;
    }
    const firstPublished = entries.find((e) => !e.unreleased);
    if (firstPublished) set.add(firstPublished.version);
    return set;
  }, [entries, expandParam]);

  const [open, setOpen] = useState<Set<string>>(initialOpen);
  const [banner, setBanner] = useState<{
    latest: string;
    summary: string;
  } | null>(null);

  useEffect(() => {
    // Mark seen — gated by lastSeenVersion so we don't re-write the
    // same value on every soft-navigation to /settings/updates.
    if (lastSeenVersion !== currentVersion) {
      void markUpdatesSeen(currentVersion);
    }

    // Probe the upstream on mount — guarded by sessionStorage so a SPA
    // hot-reload of the same page doesn't re-hit GitHub raw. The daily
    // cron remains the canonical path; this probe just shortens the
    // delay when a user opens Settings -> Updates the moment after a
    // release lands.
    //
    // The key is namespaced to currentVersion so a fresh deploy (which
    // ships a new CHANGELOG entry) re-probes once even in the same
    // browser session. Without the version suffix, a user who probed
    // before the deploy would stay stuck on the stale banner state
    // until they fully closed the tab.
    const sessionKey = `freelane:check-updates:probed:${currentVersion}`;
    let probed = false;
    try {
      probed = sessionStorage.getItem(sessionKey) === "1";
    } catch {
      // sessionStorage unavailable (private mode + iOS quirks). Probe
      // anyway — the dedup_key on the inbox row prevents user-visible
      // duplicates either way.
    }
    if (probed) return undefined;

    let cancelled = false;
    void fetch("/api/check-updates", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        try {
          sessionStorage.setItem(sessionKey, "1");
        } catch {
          // Ignore — see note above.
        }
        if (cancelled || !data || !data.has_update) return;
        setBanner({
          latest: String(data.latest_version),
          summary: String(data.summary ?? ""),
        });
      })
      .catch(() => {
        // Silent — the daily cron is the authoritative path.
      });
    return () => {
      cancelled = true;
    };
  }, [currentVersion, lastSeenVersion]);

  const toggle = (version: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {banner && (
        // New-release banner on its own row above the build pill so the
        // eye lands on the actionable signal first instead of competing
        // with the static current-build chip on the same line.
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-foreground/90">
          New release{" "}
          <span className="font-semibold tabular">{banner.latest}</span>{" "}
          available — reload to pick it up.
        </div>
      )}
      <div className="flex flex-wrap items-baseline gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Current build
        </span>
        <span className="text-sm font-semibold tabular">{currentVersion}</span>
      </div>

      <ol className="flex flex-col gap-2">
        {entries.length === 0 && (
          <li className="rounded-md border border-dashed border-border/60 px-4 py-8 text-center text-xs text-muted-foreground">
            No changelog entries yet.
          </li>
        )}
        {entries.map((entry) => {
          const isOpen = open.has(entry.version);
          const total = SECTION_ORDER.reduce(
            (acc, key) => acc + entry.sections[key].length,
            0,
          );
          return (
            <li
              key={entry.version}
              className="overflow-hidden rounded-lg border border-border/60 bg-card"
            >
              <button
                type="button"
                onClick={() => toggle(entry.version)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.04]"
                aria-expanded={isOpen}
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-display text-sm font-medium text-foreground">
                    {entry.version}
                  </span>
                  {entry.date && (
                    <span className="text-[11px] tabular text-muted-foreground">
                      {entry.date}
                    </span>
                  )}
                  {entry.unreleased && (
                    <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      Unreleased
                    </span>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    {total} change{total === 1 ? "" : "s"}
                  </span>
                </div>
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
              </button>
              {isOpen && (
                <div className="border-t border-border/50 px-3 py-3">
                  {SECTION_ORDER.map((key) => {
                    const bullets = entry.sections[key];
                    if (bullets.length === 0) return null;
                    return (
                      <div key={key} className="mb-3 last:mb-0">
                        <h3 className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                          {SECTION_LABEL[key]}
                        </h3>
                        <ul className="ml-4 list-disc text-xs leading-relaxed text-foreground/85 marker:text-muted-foreground">
                          {bullets.map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
