#!/usr/bin/env node
// Freelane: one-off CHANGELOG.md backfill emitter
// (freelane-whatsnew-design 2026-06-02, fixes the gap identified during
// the audit of migrations 0104 + 0105).
//
// The What's-New workflow pivoted the changelog source of truth from
// finance.app_changelog (SQL) to CHANGELOG.md at the repo root. The
// brief asked for a one-off script that reads the existing SQL rows and
// emits Keep-a-Changelog markdown so the maintainer can paste it into
// CHANGELOG.md before migration 0105 drops the table.
//
// Usage:
//   pnpm emit:changelog                 # prints markdown to stdout
//   pnpm emit:changelog > tmp.md        # capture to a file for editing
//
// Required env (service role — read-only intent, but writes still
// require it because finance.* is RLS-guarded by user_id):
//   SUPABASE_URL                  the project URL
//   SUPABASE_SERVICE_ROLE_KEY     server-side key (DO NOT commit)
//
// Notes:
//   - The script is intentionally read-only. It does NOT touch the SQL
//     rows; migration 0105 is the one that drops finance.app_changelog.
//   - If the table is already gone (0105 has already shipped) the
//     script reports that and exits 0 — there is nothing to emit.
//   - Output uses Keep-a-Changelog bullet lists grouped by kind
//     (`added`, `changed`, `fixed`, `removed`, `security`,
//     `deprecated`). Unknown kinds fall under "Notes".
//   - Versions are sorted newest first by `released_at`. Pinned rows
//     surface at the top of each release.
//
// This script is a maintainer tool, NOT a runtime dependency. It lives
// under scripts/ next to the existing smoke runners and shares their
// "node + minimal deps + clear failure modes" shape.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "[emit-changelog] Missing env. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n" +
      "                 (NEXT_PUBLIC_SUPABASE_URL is also accepted for the URL.)",
  );
  process.exit(2);
}

const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: "finance" },
});

const KIND_HEADERS = {
  added: "Added",
  changed: "Changed",
  fixed: "Fixed",
  removed: "Removed",
  security: "Security",
  deprecated: "Deprecated",
};

const HEADER = `# Changelog

All notable changes to Freelane are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

`;

function isoDay(ts) {
  if (!ts) return "";
  return String(ts).slice(0, 10);
}

function escapeMarkdown(s) {
  // Keep-a-Changelog bullets are forgiving; we only need to make sure a
  // stray leading dash inside a row body doesn't get reinterpreted as a
  // nested list item when pasted into the final CHANGELOG.md.
  return String(s ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => (line.startsWith("- ") ? `\\${line}` : line))
    .join("\n");
}

function renderRelease(version, rows) {
  const released = rows
    .map((r) => isoDay(r.released_at))
    .filter(Boolean)
    .sort()
    .pop();
  const grouped = new Map();
  for (const row of rows) {
    const headerKey = KIND_HEADERS[row.kind] ?? "Notes";
    if (!grouped.has(headerKey)) grouped.set(headerKey, []);
    grouped.get(headerKey).push(row);
  }
  // Pinned rows float first inside each group, then by released_at desc.
  for (const list of grouped.values()) {
    list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return String(b.released_at ?? "").localeCompare(String(a.released_at ?? ""));
    });
  }

  const out = [];
  out.push(`## [${version}]${released ? ` - ${released}` : ""}`);
  out.push("");
  for (const [heading, list] of grouped.entries()) {
    out.push(`### ${heading}`);
    out.push("");
    for (const row of list) {
      const body = escapeMarkdown(row.body ?? row.summary ?? "(no body)");
      const first = body.split("\n")[0];
      const rest = body.split("\n").slice(1);
      out.push(`- ${first}`);
      for (const line of rest) {
        out.push(`  ${line}`);
      }
    }
    out.push("");
  }
  return out.join("\n");
}

(async () => {
  // Probe for the legacy table. If 0105 already shipped, the table is
  // gone and there is nothing to emit.
  const probe = await client.from("app_changelog").select("version").limit(1);
  if (probe.error) {
    const msg = probe.error.message ?? "";
    if (/relation .* does not exist/i.test(msg) || /Could not find the table/i.test(msg)) {
      console.error(
        "[emit-changelog] finance.app_changelog is already gone (migration 0105 has " +
          "shipped). Nothing to emit. CHANGELOG.md is now the single source of truth.",
      );
      process.exit(0);
    }
    console.error(`[emit-changelog] Probe failed: ${msg}`);
    process.exit(1);
  }

  const { data, error } = await client
    .from("app_changelog")
    .select("version, released_at, kind, body, summary, pinned")
    .order("released_at", { ascending: false });
  if (error) {
    console.error(`[emit-changelog] Read failed: ${error.message}`);
    process.exit(1);
  }
  if (!data || data.length === 0) {
    console.error("[emit-changelog] No rows in finance.app_changelog. Nothing to emit.");
    process.exit(0);
  }

  // Group rows by version preserving newest-first order from the query.
  const byVersion = new Map();
  for (const row of data) {
    const key = row.version ?? "Unreleased";
    if (!byVersion.has(key)) byVersion.set(key, []);
    byVersion.get(key).push(row);
  }

  let markdown = HEADER;
  for (const [version, rows] of byVersion.entries()) {
    markdown += renderRelease(version, rows);
  }

  process.stdout.write(markdown);
})().catch((err) => {
  console.error(`[emit-changelog] Unexpected failure: ${err?.message ?? err}`);
  process.exit(1);
});
