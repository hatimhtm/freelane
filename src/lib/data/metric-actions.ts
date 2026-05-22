"use server";

import { buildMetricData, type MetricKey } from "@/lib/metric-data";
import type { MetricData } from "@/app/(app)/metric/[key]/_components/metric-detail";

export async function getMetricData(key: MetricKey): Promise<MetricData> {
  return buildMetricData(key);
}
