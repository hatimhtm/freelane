"use client";

import { useRouter } from "next/navigation";
import { SWidget } from "@/components/widgets/s-widget";
import { NumberHero } from "@/components/widgets/number-hero";

// SleepWidget — Body subtab. Last night's hours as the hero, trailing 7d
// average as the sub. Relevance-gated: hides when no morning_log rows.
type Props = {
  lastNightHours: number | null;
  trailing7dHours: number | null;
};

export function SleepWidget({ lastNightHours, trailing7dHours }: Props) {
  const router = useRouter();
  if (lastNightHours == null && trailing7dHours == null) return null;
  const hours = lastNightHours ?? trailing7dHours ?? 0;
  return (
    <SWidget
      label="Sleep"
      hero={<NumberHero value={Math.round(hours * 10) / 10} suffix="h" maximumFractionDigits={1} />}
      sub={
        trailing7dHours != null ? (
          <span>{(Math.round(trailing7dHours * 10) / 10).toFixed(1)}h · 7d avg</span>
        ) : (
          <span>last night</span>
        )
      }
      aiDot={{ key: "body.sleep", label: "Sleep" }}
      onOpen={() => router.push("/today")}
    />
  );
}
