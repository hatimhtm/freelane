import { redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { getLetters, parseLettersScope } from "@/lib/data/queries";
import { resolveScopeRange } from "@/lib/stats/queries";
import { RecentLettersWidget } from "@/components/widgets/stats/recent-letters-widget";

export const metadata = { title: "Stats · Letters" };

// LETTERS section of the Stats view (freelane-letters-design 2026-06-02).
// Surfaces the last 3 letters in scope as the Recent Letters widget; the
// "see all →" handoff lives inside the widget pointing at /letters
// (carrying the scope as a query param so the archive narrows).
//
// Scope narrowing — getLetters accepts a LettersScope. The dynamic
// [scope] segment is parsed into one of { me, year-YYYY, year (bare),
// client-<id>, window (30d/90d/6m/1y) } matching resolveScopeRange's
// grammar, and the query filters period_key / generated_at / blocks JSON
// accordingly. /me hits the full archive.
//
// Verifier fix (high): the design memo says the whole Letters section
// in Stats HIDES on zero letters in scope. The previous empty-state
// card violated that contract. We redirect to /stats/{scope}/money
// so users never land on a dead surface; the Letters subtab itself is
// omitted from the SubtabBar (see top-bar-subtab-slot.tsx) so the chip
// doesn't beckon either.
//
// Verifier fix (medium): header reads range.label (e.g. "Last 30 days",
// "2026") instead of the raw scope token — matches Money/Behavior/Journey
// and surfaces resolveScopeRange's "Lifetime (unknown scope: ...)"
// honesty fallback so an unknown URL no longer pretends to be a real
// scope. Container width normalized to max-w-6xl.

export default async function StatsLettersPage({
  params,
}: {
  params: Promise<{ scope: string }>;
}) {
  const { scope } = await params;
  const range = resolveScopeRange(scope);
  const parsedScope = parseLettersScope(scope);
  // Fetch only 3 — the "see all" link routes to /letters which does its
  // own paginated fetch, so any over-fetch here is dead weight.
  const visible = await getLetters(3, parsedScope);

  if (visible.length === 0) {
    redirect(`/stats/${scope}/money`);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 lg:px-10 lg:py-12">
      <PageHeader
        title="Letters for this scope"
        description={range.label}
      />
      <div className="mt-8">
        <RecentLettersWidget letters={visible} scope={scope} />
      </div>
    </div>
  );
}
