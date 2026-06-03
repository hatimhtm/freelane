import { notFound } from "next/navigation";
import { hasLettersInScope, parseLettersScope } from "@/lib/data/queries";
import { resolveScopeRange } from "@/lib/stats/queries";
import { StatsLettersVisibilityWriter } from "@/components/app/stats-letters-visibility";

// Stats hub — per-entity stats surface scoped by /stats/[scope]/...
// (e.g. /stats/me, /stats/client-<id>, /stats/<year>). SubtabBar
// renders in the topbar via TopBarSubtabSlot.
//
// Verifier fix (high): the Letters subtab chip must be omitted when the
// scope has zero letters (freelane-letters-design memo). We probe
// hasLettersInScope (already-existing helper in lib/data/queries) and
// push the flag into the StatsLettersVisibility context — the slot
// reads it and drops the chip when false. Pair this with the /letters
// page redirect-on-empty so the section truly hides end-to-end.
//
// Verifier fix (low): unknown scope tokens (e.g. /stats/garbage) used
// to silently render as Lifetime data with a fallback label. They now
// 404 so typos behave like real 404s. Known scopes — lifetime/me/all,
// year (bare or year-YYYY), client-<id>, 30d/90d/6m/1y windows — stay
// supported.
export default async function StatsScopeLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ scope: string }>;
}) {
  const { scope } = await params;
  const range = resolveScopeRange(scope);
  if (range.isFallback) notFound();
  const parsedScope = parseLettersScope(scope);
  const hasLetters = await hasLettersInScope(parsedScope);
  return (
    <>
      <StatsLettersVisibilityWriter has={hasLetters} />
      {children}
    </>
  );
}
