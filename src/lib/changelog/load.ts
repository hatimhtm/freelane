import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cache } from "react";

// Freelane changelog loader.
//
// CHANGELOG.md at the repo root is the single source of truth for the
// in-product "Updates" surface (Settings -> Updates) AND for the macOS
// Swift companion's What's New menu (via /api/changelog.json). This module
// hand-parses the Keep-a-Changelog markdown into a structured form the UI
// can render without an MD library.
//
// Parser contract (deliberately a SUBSET of Keep-a-Changelog):
//   - Headings of the form `## [version] - YYYY-MM-DD` start a new entry.
//   - `## [Unreleased]` (no date) is a SPECIAL entry that we surface in
//     the UI but that does NOT count as the published CURRENT_VERSION.
//   - Subheadings of the form `### Section` open a section. Recognised
//     names: Added, Changed, Fixed, Removed, Security, Deprecated. Any
//     other heading is ignored at the section level.
//   - Bullets are lines starting with `- ` (asterisk bullets are NOT
//     supported and would be silently dropped). Multi-line bullets fold
//     into one string (subsequent indented lines append with a single
//     space).
//   - Nested bullets (a `- ` line indented under a parent bullet) are
//     NOT supported — they fold into the parent bullet as a single
//     space-joined string. Authors should keep entries flat.
//   - Markdown emphasis (`**bold**`, `*italic*`, `_italic_`) is stripped
//     before display so the UI doesn't render literal asterisks.
//
// We DO NOT depend on a markdown parser. The format is tiny and our
// content is hand-authored; a regex pass is more honest than pulling
// remark + plugins into the server bundle.

export type ChangelogSectionKey =
  | "added"
  | "changed"
  | "fixed"
  | "removed"
  | "security"
  | "deprecated";

export type ChangelogEntry = {
  /** The version label as written in the heading, e.g. "1.0.0" or "Unreleased". */
  version: string;
  /** Whether the heading was marked `Unreleased` (no date). */
  unreleased: boolean;
  /** ISO date string when published, or null for the Unreleased entry. */
  date: string | null;
  sections: Record<ChangelogSectionKey, string[]>;
};

export type Changelog = {
  entries: ChangelogEntry[];
  /** The top NON-Unreleased entry's version. Used by check-for-updates. */
  currentVersion: string;
};

/**
 * Sentinel returned by the parser when CHANGELOG.md is missing, empty,
 * or malformed (no published entries). It is DELIBERATELY a string that
 * cannot appear as a real release version — semver tokens never contain
 * `__`. The check-for-updates probe treats this value as "no update
 * visible" so a broken local file can never silently disable update
 * detection in the way `"0.0.0"` (a legitimate first-release tag)
 * would have.
 */
export const MISSING_VERSION_SENTINEL = "__missing__";

const SECTION_MAP: Record<string, ChangelogSectionKey> = {
  added: "added",
  changed: "changed",
  fixed: "fixed",
  removed: "removed",
  security: "security",
  deprecated: "deprecated",
};

function emptySections(): Record<ChangelogSectionKey, string[]> {
  return {
    added: [],
    changed: [],
    fixed: [],
    removed: [],
    security: [],
    deprecated: [],
  };
}

/**
 * Strip the minimal subset of Markdown emphasis we support inside
 * bullets so the UI doesn't render literal asterisks and the
 * notification summary (`firstBullet`) reads clean. We DON'T pull a
 * markdown renderer in for this — every Freelane bullet uses one of
 * `**bold**`, `*italic*`, `_italic_`, and inline `` `code` ``.
 */
export function stripMdEmphasis(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

/**
 * Parse a Keep-a-Changelog-flavoured markdown string. Exported so the
 * runtime GitHub-raw fetch path can reuse the same parser as the
 * build-time loader.
 */
export function parseChangelog(raw: string): Changelog {
  const lines = raw.split(/\r?\n/);
  const entries: ChangelogEntry[] = [];

  let current: ChangelogEntry | null = null;
  let currentSection: ChangelogSectionKey | null = null;

  const pushBullet = (text: string) => {
    if (!current || !currentSection) return;
    current.sections[currentSection].push(stripMdEmphasis(text.trim()));
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // ## [version] - YYYY-MM-DD  OR  ## [Unreleased]
    const versionMatch = line.match(
      /^##\s+\[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?\s*$/,
    );
    if (versionMatch) {
      if (current) entries.push(current);
      const label = versionMatch[1].trim();
      const date = versionMatch[2] ?? null;
      const unreleased = label.toLowerCase() === "unreleased";
      current = {
        version: label,
        unreleased,
        date,
        sections: emptySections(),
      };
      currentSection = null;
      continue;
    }

    // ### Added | Changed | Fixed | Removed | Security | Deprecated
    // Allow trailing punctuation so `### Security.` doesn't get
    // silently dropped — we match the FIRST word and look it up in
    // SECTION_MAP. Unknown headings still close the current section
    // (currentSection = null) so stray bullets under them are ignored.
    const sectionMatch = line.match(/^###\s+([A-Za-z]+)\b[^\n]*$/);
    if (sectionMatch && current) {
      const key = sectionMatch[1].toLowerCase();
      currentSection = SECTION_MAP[key] ?? null;
      continue;
    }

    // - bullet line. Multi-line bullets fold into one entry by joining
    // any indented continuation lines (lines starting with at least two
    // spaces) with a single space.
    if (current && currentSection) {
      const bulletMatch = line.match(/^-\s+(.*)$/);
      if (bulletMatch) {
        let text = bulletMatch[1];
        // Look ahead for indented continuation lines.
        while (
          i + 1 < lines.length &&
          /^\s{2,}\S/.test(lines[i + 1]) &&
          !/^##\s/.test(lines[i + 1]) &&
          !/^###\s/.test(lines[i + 1])
        ) {
          i += 1;
          text += " " + lines[i].trim();
        }
        pushBullet(text);
      }
    }
  }
  if (current) entries.push(current);

  const firstPublished = entries.find((e) => !e.unreleased);
  // Use a sentinel that cannot collide with a real release version so
  // downstream callers (check-for-updates) can distinguish "missing /
  // broken" from a legitimate first-release tag like `0.0.0`.
  const currentVersion = firstPublished?.version ?? MISSING_VERSION_SENTINEL;

  return { entries, currentVersion };
}

// React `cache()` wraps the per-request memo. Vercel cold-starts re-read
// CHANGELOG.md from disk; warm invocations within the same request share
// the parsed result. This is exactly the "reads markdown once" contract
// the Settings -> Updates page wants without paying for it on every
// nested call inside the same render.
export const loadChangelog = cache(async (): Promise<Changelog> => {
  const path = join(process.cwd(), "CHANGELOG.md");
  const raw = await readFile(path, "utf8");
  return parseChangelog(raw);
});

/**
 * Convenience accessor for the top NON-Unreleased version. Imported by
 * the Settings nav badge + the check-for-updates brain. Lazily computed
 * (the loader is React-`cache`d, so warm calls within the same request
 * don't re-parse) so consumers can `await getCurrentVersion()` without
 * importing the loader twice.
 *
 * `CURRENT_VERSION` is a thin alias preserved for naming-symmetry with
 * the design spec (which referred to the value as `CURRENT_VERSION`).
 * Both forms return the same string; pick whichever reads better at
 * the call site.
 */
export async function getCurrentVersion(): Promise<string> {
  const { currentVersion } = await loadChangelog();
  return currentVersion;
}

export const CURRENT_VERSION = getCurrentVersion;
