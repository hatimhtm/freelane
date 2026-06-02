// SubtabBar renders in the topbar via TopBarSubtabSlot. Layout file is
// a pass-through so the /payments/[subtab] route segment resolves.
export default function PaymentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
