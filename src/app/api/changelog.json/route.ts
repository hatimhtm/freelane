import { NextResponse } from "next/server";
import { loadChangelog } from "@/lib/changelog/load";

// JSON feed for the macOS Swift app's "What's New" menu. Source pivoted
// from finance.app_changelog (dropped in migration 0105) to CHANGELOG.md
// at the repo root (freelane-whatsnew-design 2026-06-02). The shape stays
// `{ version: "1", entries: [...] }` so existing consumers keep working.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const { entries, currentVersion } = await loadChangelog();
    return NextResponse.json({
      version: "1",
      current_version: currentVersion,
      entries: entries.map((e) => ({
        version: e.version,
        unreleased: e.unreleased,
        released_at: e.date,
        sections: e.sections,
      })),
    });
  } catch {
    return NextResponse.json(
      { version: "1", current_version: null, entries: [] },
      { status: 200 },
    );
  }
}
