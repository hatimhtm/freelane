// Shared recharts defaults for the polish-pass fix to chart text bleed.
//
// Without these, each chart surface picked its own margins/widths and
// long currency tick labels (₱100,000.00) would clip on the edges or
// overlap on dense XAxis ranges. Re-export and spread into the matching
// recharts props so every chart inherits the same baseline.
//
// Used by:
//   src/components/spending/spend-over-time.tsx
//   src/components/spending/cashflow-atlas-chart.tsx
//   src/components/stats/revenue-chart.tsx
//   src/components/stats/trend-area-chart.tsx
//   src/components/stats/bars-chart.tsx

export const CHART_MARGIN = {
  top: 16,
  right: 16,
  bottom: 16,
  left: 16,
} as const;

// YAxis width that comfortably fits ₱100,000 / ₱100K compact labels
// without clipping. 48px is the calibrated minimum for compact ₱.
export const CHART_YAXIS_WIDTH = 48;

// XAxis minTickGap that keeps month/day labels from colliding on
// 6-month and 1-year ranges.
export const CHART_XAXIS_MIN_TICK_GAP = 32;
