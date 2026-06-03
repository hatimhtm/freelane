import { redirect } from "next/navigation";

// Entities moved to /clients/people (freelane-entities-design 2026-06-03).
// This page keeps the legacy URL alive for bookmarks, the in-app
// command-palette history, and any notifications already in flight that
// were composed with the old link_url.
export default function EntitiesRedirect(): never {
  redirect("/clients/people");
}
