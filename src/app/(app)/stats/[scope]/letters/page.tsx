import { PageHeader } from "@/components/app/page-header";
import { getLetters, parseLettersScope } from "@/lib/data/queries";
import { RecentLettersWidget } from "@/components/widgets/stats/recent-letters-widget";

export const metadata = { title: "Stats · Letters" };

// LETTERS section of the Stats view (freelane-letters-design 2026-06-02).
// Surfaces the last 3 letters in scope as the Recent Letters widget; the
// "see all →" handoff lives inside the widget pointing at /letters
// (carrying the scope as a query param so the archive narrows).
//
// Scope narrowing — getLetters now accepts a LettersScope. The dynamic
// [scope] segment is parsed into one of { me, year-YYYY, client-<id> }
// and the query filters period_key + blocks JSON accordingly. /me hits
// the full archive; /year-2026 narrows by period_key prefix; /client-id
// narrows by client/entity id references inside the letter blocks.
//
// Empty state — when the scope has zero letters we render a minimal
// editorial empty card so the surface is never a blank canvas. The
// Letters subtab stays clickable; users always land somewhere coherent.

export default async function StatsLettersPage({
  params,
}: {
  params: Promise<{ scope: string }>;
}) {
  const { scope } = await params;
  const parsedScope = parseLettersScope(scope);
  // Fetch only 3 — the "see all" link routes to /letters which does its
  // own paginated fetch, so any over-fetch here is dead weight.
  const visible = await getLetters(3, parsedScope);

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 lg:px-10 lg:py-12">
      <PageHeader
        title="Letters for this scope"
        description={`Scope: ${scope}`}
      />
      <div className="mt-8">
        {visible.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-foreground/15 bg-card/40 px-5 py-10 text-center">
            <div className="display-eyebrow text-muted-foreground">
              No letters here yet
            </div>
            <p className="mx-auto mt-3 max-w-[420px] text-[13px] leading-relaxed text-foreground/75">
              Letters land in this scope when the editorial brain writes about
              this slice — a year, a client, or you. Nothing yet for{" "}
              <span className="font-medium text-foreground/90">{scope}</span>.
            </p>
          </div>
        ) : (
          <RecentLettersWidget letters={visible} scope={scope} />
        )}
      </div>
    </div>
  );
}
