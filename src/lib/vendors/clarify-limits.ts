import "server-only";

// Locked vendor_clarify cadence constants — shared by the synchronous
// kickoff (canonicalize-kickoff.ts) AND the per-batch backfill cron
// (backfill.ts) so neither path can drift from the freelane-vendors-design
// spec ("max 3/day per user, 30-minute debounce per vendor").
//
// Before this module both paths held private copies — kickoff at 3/day,
// backfill at 5/day — meaning a worst-case interleaving could push 8/day.
// The user has no way to reason about the cap when the two halves of the
// system disagree, so we collapse to the single locked number.

export const VENDOR_CLARIFY_PER_DAY_CAP = 3;
export const VENDOR_CLARIFY_ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const VENDOR_CLARIFY_PER_VENDOR_DEBOUNCE_MS = 30 * 60 * 1000;
