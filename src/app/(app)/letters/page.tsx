import { getLetters, getDistinctLetterYears } from "@/lib/data/queries";
import { LettersView } from "./_components/letters-view";

export const metadata = { title: "Letters" };

const INITIAL_LIMIT = 12;

// Letters archive (freelane-letters-design 2026-06-02). Single paginated
// list, most recent first. Initial load 12 letters; "Load more" appends
// 12 more via loadMoreLettersAction. Letters live forever — no archive
// section. Milestones / quiet receipts / what-changed split off to the
// /activity feed.
//
// Server-side preload of distinct PHT years so the year-filter chip set
// reflects the full archive (not just the first page). Without this a
// user with 2024 letters and 12+ 2026 letters would not see the 2024
// chip until they paginated back far enough.
//
// Query params honour the Stats RecentLettersWidget 'see all' link so the
// scope the user was viewing carries into the archive:
//   /letters?year=2026          → preselect 2026 year chip
//   /letters?client=<entity_id> → narrow to letters referencing client
export default async function LettersPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; client?: string }>;
}) {
  const { year: yearStr, client: clientId } = await searchParams;
  const initialYear = (() => {
    if (!yearStr) return null;
    const y = Number(yearStr);
    return Number.isFinite(y) ? y : null;
  })();
  const initialClientId =
    typeof clientId === "string" && clientId.length > 0 ? clientId : null;

  const [letters, distinctYears] = await Promise.all([
    // Over-fetch by one so we can compute hasMore without a second
    // round-trip on the initial render. When a client narrowing is in
    // play we let the server pre-filter through the LettersScope.
    initialClientId
      ? getLetters(INITIAL_LIMIT + 1, { kind: "client", clientId: initialClientId })
      : initialYear
      ? getLetters(INITIAL_LIMIT + 1, { kind: "year", year: initialYear })
      : getLetters(INITIAL_LIMIT + 1),
    getDistinctLetterYears(),
  ]);
  const hasMore = letters.length > INITIAL_LIMIT;
  return (
    <LettersView
      letters={hasMore ? letters.slice(0, INITIAL_LIMIT) : letters}
      hasMore={hasMore}
      availableYears={distinctYears}
      initialYear={initialYear}
      initialClientId={initialClientId}
    />
  );
}
