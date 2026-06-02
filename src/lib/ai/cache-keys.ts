// Pure constants — separated from the "use server" cache module so the
// catalogue is importable from both server and client (or any other
// non-server-action context) without dragging the action machinery in.
//
// Why this file exists: Next's `"use server"` modules are restricted to
// exporting async server actions. Co-locating BRAIN_KEYS / BRAIN_TTL with
// readBrainCache/withBrainCache in cache.ts is convenient until any
// non-server module needs the catalogue (e.g. tests, the typed config
// surface, or another server module that just wants the list).

// Common TTLs per brain. The brief's stated minimum is 24h — explicit
// invalidation (on every significant mutation) is the freshness lever, NOT
// shorter TTLs. The earlier 2h SAFE_TO_SPEND_AI / 6h INCOME_STRIP carve-outs
// dropped to 24h on review: every spend ≥ ₱200, every payment / wallet
// anchor / planned spend / recurring rule mutation already busts the cache
// via invalidateAiSafeSpendCache (data/actions.ts), so a shorter TTL just
// burns Gemini cost on data that didn't change.
export const BRAIN_TTL = {
  SAFE_TO_SPEND_AI: 24 * 60 * 60 * 1000,
  CALM_WEATHER: 24 * 60 * 60 * 1000,
  DAILY_FOCUS: 24 * 60 * 60 * 1000,
  FORECAST_STORY: 24 * 60 * 60 * 1000,
  PACK_RHYTHM: 24 * 60 * 60 * 1000,
  LATE_NIGHT: 24 * 60 * 60 * 1000,
  SLEEP_ECHO: 24 * 60 * 60 * 1000,
  SADAKA_RHYTHM: 24 * 60 * 60 * 1000,
  POST_PAYDAY: 24 * 60 * 60 * 1000,
  EID_PREP: 24 * 60 * 60 * 1000,
  TUESDAY_CHECKIN: 24 * 60 * 60 * 1000,
  YEAR_RECALL: 24 * 60 * 60 * 1000,
  INCOME_STRIP: 24 * 60 * 60 * 1000,
  TIGHT_MODE: 24 * 60 * 60 * 1000,
} as const;

export const BRAIN_KEYS = {
  SAFE_TO_SPEND_AI: "safe_to_spend_ai",
  CALM_WEATHER: "calm_weather",
  DAILY_FOCUS: "daily_focus",
  FORECAST_STORY: "forecast_story",
  PACK_RHYTHM: "pack_rhythm",
  LATE_NIGHT: "late_night",
  SLEEP_ECHO: "sleep_echo",
  SADAKA_RHYTHM: "sadaka_rhythm",
  POST_PAYDAY: "post_payday",
  EID_PREP: "eid_prep",
  TUESDAY_CHECKIN: "tuesday_checkin",
  YEAR_RECALL: "year_recall",
  INCOME_STRIP: "income_strip",
  TIGHT_MODE: "tight_mode",
} as const;

export type BrainKey = (typeof BRAIN_KEYS)[keyof typeof BRAIN_KEYS];

// Lookup table keyed by the stored brain_key string (the BRAIN_KEYS value)
// so withBrainCache can do `BRAIN_TTL_BY_KEY[brainKey]` without a manual
// reverse-map. Derived from BRAIN_TTL at module load — adding a new brain
// to BRAIN_KEYS + BRAIN_TTL automatically populates this.
export const BRAIN_TTL_BY_KEY: Record<BrainKey, number> = {
  [BRAIN_KEYS.SAFE_TO_SPEND_AI]: BRAIN_TTL.SAFE_TO_SPEND_AI,
  [BRAIN_KEYS.CALM_WEATHER]: BRAIN_TTL.CALM_WEATHER,
  [BRAIN_KEYS.DAILY_FOCUS]: BRAIN_TTL.DAILY_FOCUS,
  [BRAIN_KEYS.FORECAST_STORY]: BRAIN_TTL.FORECAST_STORY,
  [BRAIN_KEYS.PACK_RHYTHM]: BRAIN_TTL.PACK_RHYTHM,
  [BRAIN_KEYS.LATE_NIGHT]: BRAIN_TTL.LATE_NIGHT,
  [BRAIN_KEYS.SLEEP_ECHO]: BRAIN_TTL.SLEEP_ECHO,
  [BRAIN_KEYS.SADAKA_RHYTHM]: BRAIN_TTL.SADAKA_RHYTHM,
  [BRAIN_KEYS.POST_PAYDAY]: BRAIN_TTL.POST_PAYDAY,
  [BRAIN_KEYS.EID_PREP]: BRAIN_TTL.EID_PREP,
  [BRAIN_KEYS.TUESDAY_CHECKIN]: BRAIN_TTL.TUESDAY_CHECKIN,
  [BRAIN_KEYS.YEAR_RECALL]: BRAIN_TTL.YEAR_RECALL,
  [BRAIN_KEYS.INCOME_STRIP]: BRAIN_TTL.INCOME_STRIP,
  [BRAIN_KEYS.TIGHT_MODE]: BRAIN_TTL.TIGHT_MODE,
};

// Single source of truth for the catalogue. Used by invalidateAiSafeSpendCache
// so the delete list can never drift from BRAIN_KEYS — every new brain
// declared above is automatically included.
export const ALL_BRAIN_KEYS: readonly BrainKey[] = Object.values(BRAIN_KEYS) as BrainKey[];

// Brains deliberately EXEMPT from financial-mutation invalidation. These are
// not driven by spend / payment / wallet state (year_recall keys off the
// running history bucket; eid_prep keys off the Hijri calendar). TTL is the
// only freshness signal that matters for them.
export const FINANCIAL_INVALIDATION_EXEMPT: readonly BrainKey[] = [
  BRAIN_KEYS.YEAR_RECALL,
  BRAIN_KEYS.EID_PREP,
] as const;

// Below-this threshold spends do NOT bust the AI brain cache. A ₱5 cigarette
// doesn't change the headline meaningfully, but a ₱200+ spend does. Above
// this threshold (and for every other mutation kind — payments, wallet anchors,
// recurring rules, plans) invalidation is unconditional.
export const SPEND_INVALIDATION_FLOOR_BASE = 200;
