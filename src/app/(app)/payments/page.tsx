import { redirect } from "next/navigation";

export const metadata = { title: "Payments" };

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; project?: string; withdraw?: string }>;
}) {
  const params = await searchParams;
  // Most external links land on Wallets — withdraw=1 jumps straight to the
  // withdrawal modal on Wallets (it can open the modal from there). new=1 or
  // project= mean the user wants the payment log, which lives on History.
  const target =
    params.new === "1" || params.project ? "/payments/history" : "/payments/wallets";
  const sp = new URLSearchParams();
  if (params.new) sp.set("new", params.new);
  if (params.project) sp.set("project", params.project);
  if (params.withdraw) sp.set("withdraw", params.withdraw);
  const qs = sp.toString();
  redirect(`${target}${qs ? `?${qs}` : ""}`);
}
