// Philippines cost-of-living constants + AI context.
//
// Two consumers:
//   1. safe-to-spend.ts uses PH_DAILY_FLOOR_BASE as the absolute floor below
//      which the formula never recommends, even when commitments swallow the
//      discretionary pool.
//   2. AI prompts include PH_COL_CONTEXT verbatim so the model has priors for
//      what "reasonable" looks like in PHP — and can spot anomalies vs both
//      the user's pattern AND the local norm.
//
// Values are 2026-rough. Treat as priors, not rules. The user's observed
// spending pattern ALWAYS overrides these — these only inform the model's
// common-sense when patterns are sparse or interpreted out of context.

export const PH_DAILY_FOOD_FLOOR_BASE = 250;
export const PH_DAILY_TRANSPORT_FLOOR_BASE = 150;

// Absolute daily minimum (food + minimum transport). The safe-to-spend formula
// won't recommend less than this — better to surface "your commitments are
// crowding out essentials" than to suggest a number that's unrealistic.
export const PH_DAILY_FLOOR_BASE =
  PH_DAILY_FOOD_FLOOR_BASE + PH_DAILY_TRANSPORT_FLOOR_BASE;

// Reference budgets (PHP, monthly unless noted). The AI uses these as priors
// when interpreting your spending — it never enforces them.
export const PH_REFERENCE_BUDGETS = {
  groceries_monthly:        { low: 5_000,  typical: 10_000, high: 18_000 },
  transport_monthly:        { low: 2_000,  typical: 4_000,  high: 7_000  },
  utilities_monthly:        { low: 1_500,  typical: 3_000,  high: 5_000  },
  rent_monthly_metro:       { low: 8_000,  typical: 15_000, high: 35_000 },
  rent_monthly_provincial:  { low: 3_000,  typical: 6_000,  high: 12_000 },
  fastfood_per_meal:        { low: 80,     typical: 150,    high: 280    },
  cooked_meal_per_serving:  { low: 40,     typical: 80,     high: 150    },
  jeepney_one_way:          { low: 13,     typical: 15,     high: 25     },
  tricycle_short_ride:      { low: 20,     typical: 30,     high: 60     },
  grab_short_ride:          { low: 80,     typical: 150,    high: 300    },
} as const;

// Compact string fed to Gemini in safe-to-spend + ask-your-money prompts.
// Kept short on purpose — every character is real tokens at every AI call.
export const PH_COL_CONTEXT = `PH cost-of-living priors (PHP, 2026; user's actual pattern overrides):
- Floor: ~₱${PH_DAILY_FOOD_FLOOR_BASE}/day food (1 cooked + 1 ordered) + ~₱${PH_DAILY_TRANSPORT_FLOOR_BASE}/day transport (2-3 jeep/tric rides).
- Typical monthly: groceries ₱5-18k, transport ₱2-7k, utilities ₱1.5-5k.
- Metro rent ₱8-35k (₱15k = solid 1BR); provincial ₱3-12k.
- Fastfood meal ₱80-280; home-cooked ₱40-150 per serving.
- Jeepney ₱13-25, tricycle ₱20-60, Grab short ride ₱80-300.

Use as priors only. Never suggest cuts below the floor. The user's freelance
income fluctuates — lean months call for tighter spending, strong months allow
modest expansion. Spread any recovery from overspending GENTLY across weeks,
not days.`;
