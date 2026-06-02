"use client";

import { MWidget } from "@/components/widgets/m-widget";
import type { ForecastSummary } from "@/lib/ai/forecast-summary";

// /dashboard/money — plain-English forecast headline. M widget (hero =
// one-liner, sub = end_of_month_estimate, supporting = callouts joined).

type Props = {
  summary: ForecastSummary | null;
};

export function ForecastWidget({ summary }: Props) {
  if (!summary) {
    return (
      <MWidget
        label="Forecast"
        eyebrow="FORECAST"
        hero={<span className="text-[18px]">Not enough data to call yet.</span>}
        sub="Forecast lights up after 30 days of activity."
        aiDot={{ key: "money.forecast", label: "Forecast" }}
      />
    );
  }
  return (
    <MWidget
      label="Forecast"
      eyebrow="FORECAST"
      hero={<span className="text-[20px] leading-snug">{summary.one_liner}</span>}
      sub={<span>{summary.end_of_month_estimate}</span>}
      supporting={
        summary.callouts.length > 0 ? (
          <span>{summary.callouts.join(" · ")}</span>
        ) : undefined
      }
      aiDot={{
        key: "money.forecast",
        label: "Forecast",
        data: {
          confidence: summary.confidence,
          end_of_month_estimate: summary.end_of_month_estimate,
        },
      }}
    />
  );
}
