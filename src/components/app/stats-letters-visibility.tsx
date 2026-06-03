"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// ────────────────────────────────────────── StatsLettersVisibilityContext ──
// Verifier fix (high): the freelane-letters-design memo requires the
// Letters subtab chip to HIDE when the current /stats/[scope] has zero
// letters. The TopBarSubtabSlot is a client component that only has
// access to the URL; the letter count is a server-side query. This
// context bridges the gap:
//
//   1. The /stats/[scope] layout (server) calls getLetters(1, parsed)
//      and renders <StatsLettersVisibilityWriter has={count > 0} />.
//   2. <Writer> is a thin client component that pushes the boolean into
//      the shared context on mount + whenever it changes.
//   3. <TopBarSubtabSlot> reads the context; on stats pages, it omits
//      the Letters chip whenever the flag is false.
//
// The flag is reset to null on first mount so other surfaces don't read
// a stale stats-only signal.

type StatsLettersVisibilityState = {
  hasLetters: boolean | null;
  setHasLetters: (v: boolean | null) => void;
};

const StatsLettersVisibilityContext = createContext<StatsLettersVisibilityState>({
  hasLetters: null,
  setHasLetters: () => {},
});

export function StatsLettersVisibilityProvider({ children }: { children: ReactNode }) {
  const [hasLetters, setHasLetters] = useState<boolean | null>(null);
  return (
    <StatsLettersVisibilityContext.Provider value={{ hasLetters, setHasLetters }}>
      {children}
    </StatsLettersVisibilityContext.Provider>
  );
}

export function useStatsLettersVisibility(): boolean | null {
  return useContext(StatsLettersVisibilityContext).hasLetters;
}

// Mount-only writer — children = none. The server component renders
// this with a `has` prop pre-computed; the writer reflects it into the
// context on mount.
//
// Verifier fix (medium): cleanup no longer resets to null on unmount.
// Navigating /stats/<a>/money → /stats/<b>/money used to set the flag
// to null briefly between unmount and the next Writer's mount, which
// blinked the chip out and back in. With overwrite-in-place semantics,
// the new Writer's effect simply overwrites the stale value and the
// chip never disappears mid-navigation. Non-stats pages don't read
// this context (the slot only consults it under /stats/), so leaving
// a stale boolean there has no visible effect off-stats.
export function StatsLettersVisibilityWriter({ has }: { has: boolean }) {
  const { setHasLetters } = useContext(StatsLettersVisibilityContext);
  useEffect(() => {
    setHasLetters(has);
  }, [has, setHasLetters]);
  return null;
}
