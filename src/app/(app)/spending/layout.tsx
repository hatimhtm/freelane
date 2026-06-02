// SubtabBar renders in the topbar via TopBarSubtabSlot. The sibling
// dynamic routes /spending/category/[id] and /spending/vendor/[slug]
// continue to render under this layout unchanged — they're detail
// surfaces, not subtabs, and TopBarSubtabSlot skips them.
export default function SpendingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
