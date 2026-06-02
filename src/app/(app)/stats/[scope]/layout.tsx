// Stats hub — per-entity stats surface scoped by /stats/[scope]/...
// (e.g. /stats/me, /stats/client-<id>, /stats/<year>). SubtabBar
// renders in the topbar via TopBarSubtabSlot. Layout is a pass-through.
export default function StatsScopeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
