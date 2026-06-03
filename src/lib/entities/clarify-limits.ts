import "server-only";

// Locked entity_clarify cadence constants — shared by the synchronous
// kickoff (discovery.ts:kickoffEntityCanonicalize) AND the per-batch
// backfill cron (backfill.ts) so neither path can drift from the
// freelane-entities-design spec ("max 3/day per user, 30-minute debounce
// per entity"). Mirrors the Vendors workflow's clarify-limits module —
// see /Volumes/External Mac/Desktop/Tools/freelane/src/lib/vendors/clarify-limits.ts.
//
// Per Next 16 use-server rule: this file does NOT carry "use server" so
// the bare constant exports are allowed. Importers stay server-side via
// the `import "server-only"` guard.

export const ENTITY_CLARIFY_PER_DAY_CAP = 3;
export const ENTITY_CLARIFY_ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const ENTITY_CLARIFY_PER_ENTITY_DEBOUNCE_MS = 30 * 60 * 1000;

// Gate-neutral alias for the 24h window — both Gate 1 (discovery) and
// Gate 2 (clarify) cap on the same 24h sliding window. Verifier flagged
// the original ENTITY_CLARIFY_ONE_DAY_MS as gate-misnamed when the Gate
// 1 discovery cap site reused it. The new constant reads symmetrically
// with ENTITY_DISCOVERY_PER_DAY_CAP at the call site.
export const ENTITY_GATE_ONE_DAY_MS = ENTITY_CLARIFY_ONE_DAY_MS;
export const ENTITY_DISCOVERY_ONE_DAY_MS = ENTITY_CLARIFY_ONE_DAY_MS;

// Gate 1 (entity_discovery_request) has its own per-day budget — the
// brief locks it at 2/day so onboarding doesn't drown in discovery
// requests when a single spend note mentions five people. The overflow
// queues + drips out next day; the dispatcher persists the queued
// signals via the brain cache row's fingerprint so the same signal
// doesn't burn a request slot every cron sweep.
export const ENTITY_DISCOVERY_PER_DAY_CAP = 2;
