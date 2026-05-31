import Link from "next/link";
import { getAppChangelog } from "@/lib/data/queries";
import type { AppChangelogEntry, AppChangelogKind } from "@/lib/supabase/types";

export const metadata = { title: "What's New" };

const KIND_BADGE: Record<AppChangelogKind, string> = {
  release: "Release",
  improvement: "Improvement",
  fix: "Fix",
  note: "Note",
};

const KIND_TONE: Record<AppChangelogKind, string> = {
  release: "border-foreground/30 text-foreground bg-foreground/[0.04]",
  improvement: "border-foreground/15 text-foreground/80",
  fix: "border-overdue/40 text-overdue",
  note: "border-foreground/10 text-muted-foreground italic",
};

export default async function ChangelogPage() {
  const entries = await getAppChangelog(80);

  return (
    <div className="mx-auto flex max-w-[820px] flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-lg leading-tight">What&apos;s new in Freelane</h1>
          <p className="text-xs text-muted-foreground">
            Every release that lands in the web app — and what&apos;s coming next on the macOS build.
          </p>
        </div>
        <Link
          href="/api/changelog.json"
          className="text-[11px] uppercase tracking-wider text-muted-foreground underline-offset-4 hover:underline"
        >
          JSON feed
        </Link>
      </header>

      <ol className="flex flex-col gap-5">
        {entries.length === 0 && (
          <li className="rounded-md border border-dashed border-border/60 px-4 py-8 text-center text-xs text-muted-foreground">
            No changelog entries yet.
          </li>
        )}
        {entries.map((e) => (
          <ChangelogEntry key={e.id} entry={e} />
        ))}
      </ol>
    </div>
  );
}

function ChangelogEntry({ entry }: { entry: AppChangelogEntry }) {
  return (
    <li className="grid grid-cols-[120px_1fr] gap-5 border-t border-border/40 pt-4 first:border-0 first:pt-0">
      <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        <span className="font-display text-sm font-medium text-foreground">{entry.version}</span>
        <span className="text-[11px] tabular">{entry.released_at}</span>
        <span
          className={`mt-1 w-fit rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${KIND_TONE[entry.kind]}`}
        >
          {KIND_BADGE[entry.kind]}
        </span>
        {entry.tier !== null && (
          <span className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            Tier {entry.tier}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-base font-medium leading-snug">{entry.title}</h2>
        {entry.body && (
          <p className="text-sm leading-relaxed text-foreground/85">{entry.body}</p>
        )}
        {entry.highlights.length > 0 && (
          <ul className="ml-4 list-disc text-xs leading-relaxed text-foreground/75 marker:text-muted-foreground">
            {entry.highlights.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}
