// Verifier fix (low): /stats/[scope] previously did a server redirect
// to /stats/[scope]/money on every navigation. That's an extra
// round-trip + an extra render of SubtabBar with no active tab. We
// now render the Money page directly so the bare-scope URL is
// canonical and chip clicks resolve in a single hop.
//
// The Money page expects the same params shape — re-export so the
// behaviour is identical between /stats/2026 and /stats/2026/money.
import StatsMoneyPage, { metadata as moneyMetadata } from "./money/page";

export const metadata = moneyMetadata;

export default StatsMoneyPage;
