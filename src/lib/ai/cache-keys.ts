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
  // Chatbot stack (see freelane-chatbot-design memory).
  //   CHATBOT_PILLS: lazy on modal open — 5m is fine, the page snapshot
  //     barely shifts in that window. Forced regen on financial mutation
  //     via ALL_BRAIN_KEYS still keeps things honest.
  //   STATE_SNAPSHOT: full Freelane situation digest sent into the Pro
  //     chat-answer brain on session start. 5m TTL + significant-event
  //     invalidation gives the model fresh ground without re-billing every
  //     keystroke.
  //   SESSION_DIGEST: terminal (written once per session-end); the value
  //     never changes after that, so the TTL is effectively the row's
  //     lifetime. 24h here is just a cache-shelf marker.
  //   PICK_NEXT_QUESTION: selection is cheap to re-run on state change —
  //     1h is the calm-time freshness; explicit invalidation on new
  //     wallet/client/vendor/plan still beats the TTL.
  CHATBOT_PILLS: 5 * 60 * 1000,
  STATE_SNAPSHOT: 5 * 60 * 1000,
  SESSION_DIGEST: 24 * 60 * 60 * 1000,
  PICK_NEXT_QUESTION: 60 * 60 * 1000,
  // Dashboard money tab forecast — plain-English summary of the next 30
  // days driven by the unified ledger + active plans + upcoming recurring
  // outflows. 24h TTL like the rest of the Pro-model brains. Explicit
  // invalidation on every spend/payment/plan mutation keeps the freshness
  // honest between calendar buckets.
  FORECAST_SUMMARY: 24 * 60 * 60 * 1000,
  // Sadaka workflow.
  //   SADAKA_SUGGESTED_TODAY: 24h, PHT-day anchored. The daily nudge
  //     re-evaluates once per PHT day; financial-mutation invalidation
  //     keeps it honest between bills + spends.
  //   SADAKA_CONTRIBUTION_RATE: catalogue-only — the brain runs uncached
  //     (no withBrainCache wrapper at the call site). TTL is set to 0 so a
  //     reader of this table sees the truth instead of a stale "60s"
  //     marker. The entry exists so invalidation logic that iterates
  //     ALL_BRAIN_KEYS keeps parity.
  //   SPEND_SADAKA_CLASSIFIER: very long TTL — write-once per spend (the
  //     fingerprint includes the spend_id, so re-classifying the same spend
  //     is a cache hit until the spend is edited or the cache is dropped).
  SADAKA_SUGGESTED_TODAY: 24 * 60 * 60 * 1000,
  SADAKA_CONTRIBUTION_RATE: 0,
  SPEND_SADAKA_CLASSIFIER: 30 * 24 * 60 * 60 * 1000,
  // Clients workflow.
  //   EXTRACT_FACTS_FROM_NOTES: Flash Lite, short TTL (5m) — fingerprinted
  //     by client_id + hash(notes_text), so re-saving identical notes hits
  //     the cache instead of burning a model call. TTL still acts as a
  //     safety net if the fingerprint check ever drifts.
  //   CLIENT_PATTERN_CHANGE: Pro, ~1h TTL — keyed by (client_id, event_id)
  //     so a single event can't re-fire the brain. Per-event fingerprint
  //     makes the cache effectively write-once per payment / project
  //     status change.
  EXTRACT_FACTS_FROM_NOTES: 5 * 60 * 1000,
  CLIENT_PATTERN_CHANGE: 60 * 60 * 1000,
  // Brand Identity workflow.
  //   VENDOR_ICON_IDENTIFY: Flash Lite brain that resolves a vendor name
  //     into { canonical_name, brand_color_hex, glyph_kind, glyph_value,
  //     confidence, category_hint }. Write-once per vendor_name_normalized
  //     into finance.vendor_icon_cache. 30-day TTL is a shelf marker — the
  //     cache row IS the source of truth for the resolver and survives
  //     even after this in-memory TTL expires.
  VENDOR_ICON_IDENTIFY: 30 * 24 * 60 * 60 * 1000,
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
  CHATBOT_PILLS: "chatbot_pills",
  STATE_SNAPSHOT: "state_snapshot",
  SESSION_DIGEST: "session_digest",
  PICK_NEXT_QUESTION: "pick_next_question",
  FORECAST_SUMMARY: "forecast_summary",
  SADAKA_SUGGESTED_TODAY: "sadaka_suggested_today",
  SADAKA_CONTRIBUTION_RATE: "sadaka_contribution_rate",
  SPEND_SADAKA_CLASSIFIER: "spend_sadaka_classifier",
  EXTRACT_FACTS_FROM_NOTES: "extract_facts_from_notes",
  CLIENT_PATTERN_CHANGE: "client_pattern_change",
  VENDOR_ICON_IDENTIFY: "vendor_icon_identify",
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
  [BRAIN_KEYS.CHATBOT_PILLS]: BRAIN_TTL.CHATBOT_PILLS,
  [BRAIN_KEYS.STATE_SNAPSHOT]: BRAIN_TTL.STATE_SNAPSHOT,
  [BRAIN_KEYS.SESSION_DIGEST]: BRAIN_TTL.SESSION_DIGEST,
  [BRAIN_KEYS.PICK_NEXT_QUESTION]: BRAIN_TTL.PICK_NEXT_QUESTION,
  [BRAIN_KEYS.FORECAST_SUMMARY]: BRAIN_TTL.FORECAST_SUMMARY,
  [BRAIN_KEYS.SADAKA_SUGGESTED_TODAY]: BRAIN_TTL.SADAKA_SUGGESTED_TODAY,
  [BRAIN_KEYS.SADAKA_CONTRIBUTION_RATE]: BRAIN_TTL.SADAKA_CONTRIBUTION_RATE,
  [BRAIN_KEYS.SPEND_SADAKA_CLASSIFIER]: BRAIN_TTL.SPEND_SADAKA_CLASSIFIER,
  [BRAIN_KEYS.EXTRACT_FACTS_FROM_NOTES]: BRAIN_TTL.EXTRACT_FACTS_FROM_NOTES,
  [BRAIN_KEYS.CLIENT_PATTERN_CHANGE]: BRAIN_TTL.CLIENT_PATTERN_CHANGE,
  [BRAIN_KEYS.VENDOR_ICON_IDENTIFY]: BRAIN_TTL.VENDOR_ICON_IDENTIFY,
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
  // Client-scoped brains — keyed to a specific client + a specific event,
  // not to the user-wide money state. A spend mutation on the user's wallet
  // doesn't change the client's pattern baseline; only payments and project
  // status flips for that client do (and those refresh the baseline via
  // refreshClientPatternBaselines instead of cache invalidation).
  BRAIN_KEYS.EXTRACT_FACTS_FROM_NOTES,
  BRAIN_KEYS.CLIENT_PATTERN_CHANGE,
  // Brand Identity — vendor icon identification is keyed off the
  // normalized vendor name, never the user's money state. Spend / payment
  // mutations don't change a vendor's brand identity.
  BRAIN_KEYS.VENDOR_ICON_IDENTIFY,
] as const;

// Below-this threshold spends do NOT bust the AI brain cache. A ₱5 cigarette
// doesn't change the headline meaningfully, but a ₱200+ spend does. Above
// this threshold (and for every other mutation kind — payments, wallet anchors,
// recurring rules, plans) invalidation is unconditional.
export const SPEND_INVALIDATION_FLOOR_BASE = 200;
