import { redirect } from "next/navigation";

// Vendors moved to /spending/vendors (freelane-vendors-design 2026-06-02).
// This page keeps the legacy URL alive for bookmarks + the in-app links
// that have not been migrated yet.
export default function VendorsRedirect(): never {
  redirect("/spending/vendors");
}
