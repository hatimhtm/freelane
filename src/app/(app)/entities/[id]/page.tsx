import { redirect } from "next/navigation";

// Entity detail moved to /clients/people/[id]
// (freelane-entities-design 2026-06-03). This page keeps the legacy URL
// alive for bookmarks, the in-app command-palette history, and any
// notifications already in flight that were composed with the old
// link_url.
export default async function EntityDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/clients/people/${id}`);
}
