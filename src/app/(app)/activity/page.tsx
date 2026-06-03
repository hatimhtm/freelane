import { redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { getAuthUser } from "@/lib/auth";
import {
  getActivityFeed,
  isValidActivityCursorId,
  isValidActivityCursorTimestamp,
} from "@/lib/activity/feed";
import {
  CATEGORIES,
  type ActivityCategory,
} from "@/lib/activity/categories";
import { ActivityView } from "./_components/activity-view";

export const metadata = { title: "Activity" };

const CATEGORY_KEYS = new Set<string>(CATEGORIES.map((c) => c.key));

// Sentinel surfaced when the user actively deselects every category chip.
// `?categories=__none__` is interpreted as "show me nothing" and forces
// the empty state instead of silently re-expanding to "all categories"
// when the param's missing.
const EMPTY_CATEGORIES_SENTINEL = "__none__";

// Parses the comma-separated `categories` search-param into the typed
// ActivityCategory[] enum. Unknown values are dropped silently — typos
// in the URL never wedge the page.
function parseCategories(raw: string | null): ActivityCategory[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => CATEGORY_KEYS.has(s)) as ActivityCategory[];
}

type SearchParamsShape = {
  categories?: string | string[];
  source?: string | string[];
  day?: string | string[];
  showAi?: string | string[];
  cursor?: string | string[];
  cursorId?: string | string[];
};

// Next.js 16 server pages receive search params as a Promise; awaiting
// keeps us on the supported API.
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsShape>;
}) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const pick = (v: string | string[] | undefined): string | null => {
    if (Array.isArray(v)) return v[0] ?? null;
    return v ?? null;
  };

  const categoriesParam = pick(params.categories);
  const noneSelected = categoriesParam === EMPTY_CATEGORIES_SENTINEL;
  const categories = noneSelected ? [] : parseCategories(categoriesParam);
  const source = pick(params.source);
  const day = pick(params.day);
  const showAi = pick(params.showAi) === "1";

  // Cursor trust boundary.
  // ──────────────────────
  // `?cursor=` and `?cursorId=` come from the URL query string, which
  // anyone can craft. feed.ts splices them straight into a PostgREST
  // `.or(...)` filter — invalid shapes would either 400 or inject
  // sibling filter clauses. Validate the ISO-8601 timestamp + the
  // `<table>:<uuid>` composite id BEFORE forwarding. Reject silently
  // (treat as "no cursor"); the user just re-lands at page 1 instead
  // of seeing an error toast for a tampered URL. feed.ts re-runs the
  // same gate at the splice point as defense-in-depth.
  const rawCursor = pick(params.cursor);
  const rawCursorId = pick(params.cursorId);
  const cursor = isValidActivityCursorTimestamp(rawCursor) ? rawCursor : null;
  const cursorId =
    cursor && isValidActivityCursorId(rawCursorId) ? rawCursorId : null;

  // Honour the explicit "no categories" sentinel by short-circuiting the
  // server query — passing categories=[] to getActivityFeed would
  // otherwise be treated as "all categories" (the absence-of-filter
  // contract). The empty rows array trips the EmptyState below.
  const { rows, nextCursor, partial } = noneSelected
    ? { rows: [], nextCursor: null, partial: false }
    : await getActivityFeed({
        userId: user.id,
        cursor,
        cursorId,
        limit: 100,
        categories: categories.length > 0 ? categories : null,
        source,
        day,
        includeAi: showAi,
      });

  // Default state: all categories selected when the URL doesn't pin a
  // subset. Lets the chip row reflect "all on" without forcing every
  // load to write 6 keys into the URL. When the sentinel is set,
  // initialCategories is empty so the chip row visibly reflects the
  // "none selected" state.
  const initialCategories = noneSelected
    ? []
    : categories.length > 0
      ? categories
      : (CATEGORIES.map((c) => c.key) as ActivityCategory[]);

  return (
    <div className="mx-auto max-w-5xl p-6 lg:p-10">
      <PageHeader
        title="Activity"
        description="Everything that happened, newest first. Freelane keeps this so you — and future you — have full history."
      />
      <div className="mt-8">
        <ActivityView
          rows={rows}
          initialCategories={initialCategories}
          noneSelected={noneSelected}
          initialSource={source}
          initialDay={day}
          initialShowAi={showAi}
          nextCursor={nextCursor}
          partial={partial}
        />
      </div>
    </div>
  );
}
