// SubtabBar renders in the topbar via TopBarSubtabSlot. The sibling
// dynamic route /clients/[id] continues to render under this layout
// unchanged — TopBarSubtabSlot still surfaces the Clients/People tabs
// on detail routes so the user can swap back to the list.
export default function ClientsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
