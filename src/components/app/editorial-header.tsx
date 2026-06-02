import type { ReactNode } from "react";

// Editorial header — the locked top-of-page chrome for /dashboard.
//
// The headline + muted subline match Freelane's editorial type contract
// (display-headline / muted-foreground). Two optional slots ride on the
// right: `chips` (top, e.g. DashboardStatsChips) and `actions` (under,
// e.g. Add client / Log payment buttons).
//
// Kept deliberately presentational. The dashboard view passes pre-rendered
// chips + actions in.

export type EditorialHeaderProps = {
  headline: ReactNode;
  subline?: ReactNode;
  chips?: ReactNode;
  actions?: ReactNode;
};

export function EditorialHeader({
  headline,
  subline,
  chips,
  actions,
}: EditorialHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="display-headline text-3xl md:text-4xl">{headline}</h1>
        {subline && (
          <p className="mt-1 text-sm text-muted-foreground">{subline}</p>
        )}
      </div>
      <div className="flex max-w-full flex-col items-end gap-2 sm:max-w-[60%]">
        {chips && (
          // Wrapped in <nav> so screen readers can identify + skip the
          // chip strip as a navigation region (individual chips already
          // carry an aria-label per chip). On narrow widths the strip
          // becomes a horizontal rail rather than wrapping into a
          // multi-row block that would push the actions row off-screen.
          <nav
            aria-label="Stats scope"
            className="flex max-w-full flex-wrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {chips}
          </nav>
        )}
        {actions && (
          <div className="flex items-center gap-1.5">{actions}</div>
        )}
      </div>
    </div>
  );
}
