import "server-only";

import {
  parseChangelog,
  getCurrentVersion,
  stripMdEmphasis,
  MISSING_VERSION_SENTINEL,
} from "./load";

// Freelane "check for updates" probe.
//
// Not an AI brain. Pure fetch + semver compare. The daily cron at 9 AM
// PHT and the on-mount client check both call into this module so they
// share the same parser + dedup contract.
//
// Failure modes are silent: a network blip or a missing CHANGELOG.md on
// the remote main branch must NEVER break the in-app render. The caller
// only cares whether `has_update` is true; everything else is decoration.

const CHANGELOG_RAW_URL =
  "https://raw.githubusercontent.com/hatimhtm/freelane/main/CHANGELOG.md";

export type UpdateCheckResult = {
  current_version: string;
  latest_version: string;
  has_update: boolean;
  /**
   * The first non-empty bullet from the latest entry's `Added` (then
   * `Changed`, then `Fixed`) section, so callers can surface a one-line
   * teaser in the notification body.
   */
  summary: string;
  /**
   * Stable dedup key for the notification dispatcher:
   * `app_update_available:<version>`. Always set; the caller only
   * inserts when `has_update` is true.
   */
  dedup_key: string;
};

/**
 * Numeric-aware version compare. SUPPORTED SHAPE: dot-separated
 * numeric segments (`1.0.0`, `2026.06.0`). Mixed numeric-vs-non-
 * numeric segments fall through to a lexicographic compare, which is
 * NOT semver-correct and may surprise you — pre-release tags like
 * `1.0.0-beta.1` are NOT supported (`0-beta` sorts AFTER `0`, so a
 * beta would falsely look newer than the GA). Freelane ships
 * calendar (YYYY.MM.X) and 1.x.y today; if pre-release tags ever
 * land, swap this for a real semver compare.
 *
 * Returns positive if `a > b`, negative if `a < b`, 0 if equal.
 */
function compareVersion(a: string, b: string): number {
  const ap = a.split(".");
  const bp = b.split(".");
  const len = Math.max(ap.length, bp.length);
  for (let i = 0; i < len; i += 1) {
    const ai = ap[i] ?? "0";
    const bi = bp[i] ?? "0";
    const an = Number.parseInt(ai, 10);
    const bn = Number.parseInt(bi, 10);
    const aIsNum = Number.isFinite(an) && /^\d+$/.test(ai);
    const bIsNum = Number.isFinite(bn) && /^\d+$/.test(bi);
    if (aIsNum && bIsNum) {
      if (an !== bn) return an - bn;
      continue;
    }
    if (ai !== bi) return ai < bi ? -1 : 1;
  }
  return 0;
}

function firstBullet(entry: ReturnType<typeof parseChangelog>["entries"][number]): string {
  const { added, changed, fixed } = entry.sections;
  // Bullets are stored markdown-clean by the parser, but firstBullet
  // is also a defensive net for legacy callers that might pass raw
  // strings through. Strip emphasis again — idempotent on clean text.
  const raw = added[0] ?? changed[0] ?? fixed[0] ?? "";
  return stripMdEmphasis(raw).slice(0, 200);
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = await getCurrentVersion();

  let latestVersion = currentVersion;
  let summary = "";
  try {
    const res = await fetch(CHANGELOG_RAW_URL, {
      // The remote markdown rarely changes; a stale cache is fine for a
      // best-effort daily probe. We DO want a network read each cron tick,
      // but Next's fetch cache shouldn't keep us from picking up new
      // entries within a 24h cycle.
      cache: "no-store",
      headers: { accept: "text/plain" },
      // Bail out if a GitHub edge node hangs — without this, a stuck
      // fetch holds the cron / on-mount probe open until Vercel's
      // function timeout (60s+). 5s is generous for a ~50KB markdown
      // file; we'd rather fail-fast-silent than drag the tick.
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const raw = await res.text();
      const parsed = parseChangelog(raw);
      const top = parsed.entries.find((e) => !e.unreleased);
      if (top) {
        latestVersion = top.version;
        summary = firstBullet(top);
      }
    }
  } catch {
    // Best-effort. Treat a network failure as "no update visible".
  }

  // Defensive: if the LOCAL CHANGELOG.md is malformed or missing, the
  // loader returns MISSING_VERSION_SENTINEL (a string that cannot
  // appear as a real semver). Without this guard we'd fan an
  // `app_update_available:<remote>` row out to every user on every
  // cron tick, and the dedup key would prevent us from ever
  // re-emitting a corrected one. Treat the broken-local case as
  // "no update visible" — safer than crying wolf.
  //
  // Earlier this guard checked for the string "0.0.0", which collides
  // with a real `0.0.0` release. The sentinel can't collide.
  const localBroken =
    currentVersion === MISSING_VERSION_SENTINEL ||
    latestVersion === MISSING_VERSION_SENTINEL;
  const has_update =
    !localBroken && compareVersion(latestVersion, currentVersion) > 0;
  return {
    current_version: currentVersion,
    latest_version: latestVersion,
    has_update,
    summary,
    dedup_key: `app_update_available:${latestVersion}`,
  };
}
