import { redirect } from "next/navigation";

// T01 — root redirects to /dashboard. The new home is the bird's-eye view;
// /today is the lean glance-only page.
export default function RootPage() {
  redirect("/dashboard");
}
