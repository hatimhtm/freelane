import { notFound } from "next/navigation";
import { buildMetricData, isMetricKey, metricMeta } from "@/lib/metric-data";
import { MetricDetail } from "./_components/metric-detail";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return { title: isMetricKey(key) ? metricMeta(key).title : "Metric" };
}

export default async function MetricPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!isMetricKey(key)) notFound();

  const data = await buildMetricData(key);
  const meta = metricMeta(key);

  return <MetricDetail data={data} title={meta.title} description={meta.description} />;
}
