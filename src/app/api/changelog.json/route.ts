import { NextResponse } from "next/server";
import { getAppChangelog } from "@/lib/data/queries";

// JSON feed for the macOS Swift app's "What's New" menu. Same data the web
// /changelog page renders — single source of truth. Auth uses the same RLS
// path; the Swift client will pass the user's session cookie.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const entries = await getAppChangelog(80);
    return NextResponse.json({
      version: "1",
      entries: entries.map((e) => ({
        id: e.id,
        version: e.version,
        released_at: e.released_at,
        kind: e.kind,
        title: e.title,
        body: e.body,
        highlights: e.highlights,
        tier: e.tier,
        is_pinned: e.is_pinned,
      })),
    });
  } catch {
    return NextResponse.json({ version: "1", entries: [] }, { status: 200 });
  }
}
