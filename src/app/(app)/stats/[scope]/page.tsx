import { redirect } from "next/navigation";

export const metadata = { title: "Stats" };

export default async function StatsScopeIndex({
  params,
}: {
  params: Promise<{ scope: string }>;
}) {
  const { scope } = await params;
  redirect(`/stats/${encodeURIComponent(scope)}/money`);
}
