import { redirect } from "next/navigation";

export const metadata = { title: "Spending" };

export default async function SpendingPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; category?: string; m?: string }>;
}) {
  // Forward any existing query params (?m=2026-06, ?new=1, ?category=...)
  // to the Spends subtab so the redirect doesn't lose state from external
  // links (Today's Sadaka quick-log button, command palette, etc.).
  const params = await searchParams;
  const sp = new URLSearchParams();
  if (params.m) sp.set("m", params.m);
  if (params.new) sp.set("new", params.new);
  if (params.category) sp.set("category", params.category);
  const qs = sp.toString();
  redirect(`/spending/spends${qs ? `?${qs}` : ""}`);
}
