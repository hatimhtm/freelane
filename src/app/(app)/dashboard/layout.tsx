// SubtabBar renders in the topbar via TopBarSubtabSlot (driven by the
// pathname), so this layout is a pass-through. It still exists so the
// /dashboard/[subtab] route segment is wired the Next.js 16 way.
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
